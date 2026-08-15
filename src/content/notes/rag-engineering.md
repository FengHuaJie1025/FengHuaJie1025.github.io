---
title: "RAG 知识库工程实践：从 Milvus 到多路召回"
tags: ["RAG", "检索", "向量数据库", "Milvus", "BM25", "语义分割"]
date: 2026-08-12
summary: 基于 Milvus 向量数据库的 RAG 知识库工程实践。涵盖文档切割策略、多路召回（向量 + BM25）、结果融合算法（RRF/加权融合/Cross-Encoder）、查询重写与扩展、可量化评估体系的设计与优化。
draft: false
---

## 项目地址

https://github.com/FengHuaJie1025/FDE/tree/main/rag_knowledge_base

## 整体架构

```
API 服务层（FastAPI RESTful 接口）
       │
RAG 编排层：查询重写 → 多路召回 → 重排序 → 生成
       │
  ┌────┴────┐
Embedding   LLM 交互
  │              │
  ├─ Milvus 向量存储 ─── BM25 关键词索引
  │   ANN 搜索 + 标量过滤   中文分词检索
  └──────────┬──────────┘
       文档处理流水线：加载 → 切割 → 向量化 → 存储
```

数据流分为入库和问答两个方向：

**入库流程：** 文档文件 → 加载器 → 文本切割器 → Embedding → Milvus 写入 → BM25 索引重建

**问答流程：** 用户问题 → [查询重写] → 向量化 → 向量检索（Milvus ANN）+ 关键词检索（BM25）→ 结果融合（RRF）→ [可选 Cross-Encoder 重排序] → LLM 生成

---

## 文档切割策略

切割是 RAG 的起点，直接影响检索效果。支持三种策略：

### 递归字符分割（Recursive）

通用策略，按分隔符优先级逐级回退：

```
优先以"双换行"分割 → 其次"单换行" → 中文句号 → 感叹号/问号/分号 → 逗号 → 字符硬切
```

LangChain 的 `RecursiveCharacterTextSplitter` 配合中文标点作为分隔符，尽可能保持语义单元完整。

- chunk_size=512（约 200-300 中文词）
- chunk_overlap=64（10%+ 重叠避免切丢关键信息）

### 语义分割（Semantic）

按段落→句子边界切割，优先保持完整段落：

1. 按 `\n\n` 划分为段落
2. 如果段落不超过 chunk_size，完整保留
3. 如果段落超过，按句子边界（`。！？`）进一步切割
4. 最后处理跨段落拼接

这是一种"贪婪算法"，倾向于保留完整段落。效果优于固定长度硬切。

### Markdown 标题分割

按 `#` / `##` / `###` 标题层级分割，每个切片天然对应一个主题。最适合技术文档、README、Wiki。非 Markdown 文件回退到递归分割。

### 选择建议

| 文档类型 | 推荐策略 | 原因 |
|---------|---------|------|
| 纯文本、论文 | recursive | 通用稳定 |
| 技术文档 | markdown | 按主题分割 |
| 小说、长文章 | semantic | 保持语义完整 |

### 进一步优化：基于 Embedding 相似度的真实语义分割

当前"语义分割"只是按段落和句号切，没有真正的语义理解。改进方向：

```python
def semantic_split_improved(documents, chunk_size=256, chunk_overlap=48):
    """
    基于 Embedding 相似度的语义分割：
    1. 将文档按句子分割
    2. 对相邻句子计算 Embedding 余弦相似度
    3. 在相似度出现明显下降的位置（语义转折点）分割
    4. 贪婪合并，直到达到 chunk_size
    """
```

关键改进：
- **窗口式相似度对比**：计算连续 N 个句子的滑动窗口 Embedding 均值，相邻窗口相似度低于阈值时分割
- **保证段落不跨切**：无论任何策略，优先保证同一个段落不被切到两个 chunk
- **分层切割**：先按 Markdown 标题分层，再按段落，最后按句子

---

## Embedding 模型

### 本地模型（HuggingFace）

| 模型 | 维度 | 特点 |
|------|------|------|
| BGE-base-zh-v1.5（推荐） | 768 | BAAI 出品，中英双语，检索任务 MTEB SOTA |
| BGE-small-zh-v1.5 | 512 | 轻量版 33MB，速度 2-3x 更快，精度降约 5% |
| text2vec-base-chinese | 768 | 基于 CoSENT 训练，专注中文 |
| M3E-base | 768 | 中文优化，开源可商用 |

### 云端模型

| 模型 | 维度 | 特点 |
|------|------|------|
| text-embedding-3-small | 1536（可降维） | OpenAI 出品，性价比高 |
| text-embedding-3-large | 3072（可降维） | 质量最高，成本也高 |

### Embedding 工厂模式

通过统一接口切换模型：

```python
# BGE 本地
emb = EmbeddingModel(model_type="bge")

# OpenAI 云端
emb = EmbeddingModel(model_type="openai", api_key="sk-xxx", model_name="text-embedding-3-small")

# 统一接口
vectors = emb.embed_documents(["文本1", "文本2"])
query_vec = emb.embed_query("查询问题")
```

所有模型在 `embed_documents` 时设置 `normalize_embeddings=True`，确保向量归一化。Milvus 使用 IP（内积）作为距离度量，对于归一化向量，IP 等价于余弦相似度。

---

## 多路召回

### 为什么需要多路召回？

单一向量检索的局限性：
- 对精确关键词匹配效果差（"版本 2.4.0" vs "v2.4.0"）
- 低频专有名词 Embedding 质量不稳定
- 无法处理字面匹配需求（代码片段、错误信息）

多路召回通过融合不同信号弥补单一方法的不足。

### 向量检索

使用 Milvus 的 ANN（近似最近邻）搜索：

- **索引类型**：IVF_FLAT（倒排文件 + 全量比较）
  - nlist=1024（聚类中心）
  - nprobe=128（探查聚类数）
- **距离度量**：IP（内积），配合归一化向量等价于余弦相似度
- **标量过滤**：通过 expr 参数按来源、文件名等字段过滤

百万级以下数据用 IVF_FLAT 是精度和速度的良好平衡；更大规模可考虑 IVF_SQ8（量化压缩）或 HNSW（图索引）。

### 关键词检索（BM25）

单独实现 BM25 的原因：
- 主流向量数据库不内置全文检索
- 纯 Elasticsearch 太重量级
- jieba 分词 + BM25 轻量且有效

**中文分词**：使用 jieba，保留英文单词和数字。**参数**：k1=1.5（词频饱和度），b=0.75（文档长度归一化）。**更新**：每次入库完成后自动重建索引。

BM25 公式：
```
score(D, Q) = sum(IDF(q_i) * TF(q_i, D) * (k1+1) / (TF(q_i, D) + k1 * (1 - b + b * |D| / avgdl)))

IDF(q_i) = log((N - df(q_i) + 0.5) / (df(q_i) + 0.5) + 1)
```

---

## 结果融合策略

系统提供三种融合/重排序策略：

### 加权融合

```
final_score = 0.6 * normalized(vector_score) + 0.4 * normalized(bm25_score)
```

步骤：分别检索 → Min-Max 归一化到 [0,1] → 线性加权 → 去重 → 排序

适合快速原型，需要手动调权重。

### RRF 倒数排序融合（推荐）

```
RRF_score(d) = sum(1 / (k + rank_i(d)))    # k=60（经典值）
```

RRF 只看排名不看分数，优点突出：
- **对分数尺度不敏感**：向量分数和 BM25 分数量级差异大时也能稳定融合
- **参数少**：k=60 是业界公认通用值
- **抗噪声**：单路检索的异常分数不会拉偏结果

生产环境首推。

### Cross-Encoder 重排序

使用 `BAAI/bge-reranker-v2-m3` 等交叉编码器，对 (query, doc) 逐对计算相关度分数。单塔结构比双塔的向量检索更精确。

**优点**：精度最高，能捕获细粒度语义匹配。**缺点**：延迟高（每对一次前向传播），需要额外模型（约 1-2GB），不可大规模用。

适合质量要求极高的场景（客服、医疗、法律），且接受更高查询延迟。

### 三种策略对比

| 维度 | 加权融合 | RRF | Cross-Encoder |
|------|---------|------|---------------|
| 精度 | 中等 | 中等偏上 | 最高 |
| 延迟 | 无额外 | 无额外 | 高 |
| 参数依赖 | 需调权重 | 仅 k=60 | 需下载模型 |
| 复杂度 | 低 | 低 | 高 |
| 适用阶段 | 开发调试 | 生产默认 | 质量敏感场景 |

选择路线：数据量小 + 快速验证 → 加权融合。数据量中等 + 追求稳定 → RRF。质量要求极高 + 延迟容忍 → Cross-Encoder。

---

## 查询重写与扩展

### 查询重写

多轮对话中用户问题可能是模糊的（如"那它的性能怎么样？"）。查询重写将最近 N 轮对话历史和当前问题一起发给 LLM，生成自包含的搜索查询。

**判断是否需要重写**：不是所有查询都需重写，用规则快速判断：

```python
def should_rewrite(query):
    pronouns = {"它", "这", "那", "其", "该", "本", "此"}
    words = jieba.lcut(query)
    if len(words) < 5: return True       # 短查询需扩展
    if any(w in pronouns for w in words): return True  # 含代词需消歧
    return False
```

**复合查询分解**：对于"如何 A 和 B？"这类查询，分解为多个子查询分别检索后合并结果。

### 查询扩展

对短查询用 LLM 生成 2-3 个同义/近义变体，分别检索后用 RRF 融合。

```python
def expand_query(query):
    prompt = f"""为下面搜索查询生成 2-3 个同义或近义变体：
原始查询：{query}
要求：语义相同但措辞不同，每行一个，不要解释"""
    variants = llm_client.chat([{"role": "user", "content": prompt}])
    return [v.strip() for v in variants.strip().split("\n") if v.strip()]
```

适合：短查询（2-5 字）、专业术语变体（"RAG" → "检索增强生成"）、中英文混写。

**注意**：查询扩展增加了 LLM 调用和检索开销，建议只在 top_k 较小或首次召回置信度低时启用。

---

## 评估体系

没有可量化的指标，优化就是盲人摸象。

### 评估数据集

```python
evaluation_data = [
    {
        "question": "如何安装 Milvus？",
        "expected_sources": ["docs/install.md"],
        "expected_keywords": ["docker", "compose", "安装", "部署"],
        "relevant_chunks": [12, 15, 18],
    },
]
```

准备 50-100 个带标注的 QA 对，覆盖各种查询类型。

### 核心指标

| 指标 | 说明 | 计算方式 |
|------|------|----------|
| **Recall@K** | K 条结果中包含多少比例的相关文档 | `#相关结果 / #总相关文档` |
| **MRR** | 第一个相关结果的排名倒数均值 | `mean(1 / rank_first_relevant)` |
| **NDCG@K** | 考虑排序质量的召回，有位置衰减 | 标准 NDCG 计算 |
| **Precision@K** | K 条结果中有多少比例相关 | `#相关结果 / K` |

### 评估流程

1. 准备 50-100 个标注 QA 对
2. 每次修改参数后全量跑一遍评估
3. 对比指标变化决定是否采纳
4. 定期更新评估数据集覆盖新文档

---

## 召回质量优化方向

### 第一阶段：立竿见影

| 优化项 | 预期收益 | 工作量 |
|--------|----------|--------|
| 默认切割改为 semantic/256/48 | 召回 +15-25% | 低（改配置） |
| 引入中文停用词表到 BM25 | BM25 +10-20% | 低（加停用词表） |
| rerank_top_k 从 3 提到 5-8 | 覆盖更多结果 | 低（改配置） |
| 默认使用 BGE-base（768 维） | 向量精度 +10% | 中（下载模型） |

### 第二阶段：增量改进

| 优化项 | 预期收益 | 工作量 |
|--------|----------|--------|
| 单轮查询重写 + 规则判断 | 短查询召回 +20-30% | 中 |
| 真正语义分割（基于 Embedding） | 切割质量 +20% | 中 |
| 多样性约束（同源最多 2 条） | 结果多样性 +30% | 低 |

### 第三阶段：进阶优化

| 优化项 | 预期收益 | 工作量 |
|--------|----------|--------|
| 查询扩展（LLM 生成变体） | 语义召回 +10-15% | 中 |
| 自适应混合检索权重 | 不同查询 +5-10% | 高 |
| 评估 pipeline | 质量可量化 | 高 |
| BM25 增量更新 | 入库速度 +50% | 中 |

### 自适应混合搜索

按查询类型动态调整权重：

```python
def adaptive_hybrid_search(query, vector_results, keyword_results):
    if contains_code_or_version(query):
        return weighted_rrf(vector_results, keyword_results, w_vector=0.3, w_bm25=0.7)
    elif is_semantic_query(query):
        return weighted_rrf(vector_results, keyword_results, w_vector=0.7, w_bm25=0.3)
    else:
        return weighted_rrf(vector_results, keyword_results, w_vector=0.5, w_bm25=0.5)
```

### 多样性约束

最终 Top-K 中，同一文档的连续片段最多保留 2 个，避免多条结果来自同一段落只是被切开。

---

## 技术选型

### 为什么选择 Milvus？

| 对比项 | Milvus | FAISS | Elasticsearch | Qdrant |
|--------|--------|-------|---------------|--------|
| 分布式 | 原生 | 自行实现 | 支持 | 支持 |
| 混合检索 | 向量+标量过滤 | 仅向量 | 需插件 | 向量+Payload |
| 部署 | 中等 | 低 | 高 | 中等 |
| 性能（10M 级） | 高 | 高 | 中等 | 高 |

选择 Milvus 而非 FAISS 的原因是 Milvus 原生支持分布式、数据持久化和标量过滤。选择 Milvus 而非 ES 的原因是 ES 的向量检索能力相对较新且性能不如专用向量数据库。

### 为什么用 BGE 而非 OpenAI Embedding？

- MTEB 中文检索榜单前三
- 模型体积小（33MB），CPU 可运行
- Apache 2.0 开源协议，可商用
- 支持 normalize，与 IP 距离配合完美

### 为什么自定义 BM25 而非 Elasticsearch？

- 轻量，无需额外部署
- 与向量检索在同一 Python 进程中完成
- jieba 分词，中文支持完善
- 数据量增加后可替换为 ES 或 Meilisearch