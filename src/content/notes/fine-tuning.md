---
title: "大模型微调入门：从 SFT 到 QLoRA 完整指南"
tags: ["LLM", "微调", "Fine-tuning", "SFT", "LoRA", "QLoRA", "AI"]
date: 2026-07-01
summary: 什么时候该微调、什么时候 Prompt 就够了？从 SFT、LoRA 到 QLoRA 的原理到实操，手把手带你完成第一次模型微调。
draft: false
---

## 为什么需要微调

大模型很强大，但有一个核心局限：**它学的是通用知识，不是你的知识。**

你问它写代码，它能写出合理代码，但不懂你们公司的内部框架、命名规范和开发流程。你问它做客服，它能回复通用问题，但不知道你们的产品细节和话术风格。

微调（Fine-tuning）就是在通用大模型的基础上，用**你自己的数据**再训练一轮，让它学会特定领域的能力。

但微调不是银弹。在动手之前，你需要先回答一个问题：**微调真的比调 Prompt 更划算吗？**

---

## 微调 vs Prompt Engineering：怎么选

| 场景 | 推荐方案 | 原因 |
|------|---------|------|
| 让模型换一种语气回复 | Prompt | 成本低，改一行代码即可 |
| 约束输出格式（JSON/表格） | Prompt | 结构化输出是 Prompt 的核心能力 |
| 模型经常答非所问 | Prompt + 示例 | Few-shot 示例通常能解决 |
| 需要记住私有领域知识 | RAG | 知识会变化，微调会过时 |
| 需要特定的专业判断逻辑 | **微调** | 需要内化到模型参数中 |
| 需要模型遵循公司规范 | **微调** | 规范稳定，一次训练长期受益 |
| 特定领域的文本生成 | **微调** | 风格一致、专业术语准确 |

**简单判断法**：如果问题可以通过"给更多上下文"或"多给几个例子"解决，先用 Prompt。只有当模型**理解上存在根本性偏差**（比如它不知道你们公司的内部术语、流程、规范），才考虑微调。

---

## 微调的三种方式

### 1. SFT（Supervised Fine-Tuning，监督微调）

最基础也最常用的方式。给模型一批输入-输出对，让它学习映射关系。

```
输入: "订单 ORD-2024-001 的发货状态是什么？"
输出: "订单 ORD-2024-001 已于 2026-08-10 发货，预计 2026-08-12 到达。"
```

喂给模型成千上万条这样的数据，模型就会学会你们公司的客服话术风格。

**适合**：对话风格、格式化输出、特定领域的问答。

### 2. RLHF（Reinforcement Learning from Human Feedback，人类反馈强化学习）

先做 SFT，再用人类标注数据对模型进行偏好训练。

流程：
1. 用同一组输入，让模型生成多个回答
2. 人类标注员对这些回答排序（哪个更好）
3. 用排序数据训练一个奖励模型（Reward Model）
4. 用强化学习优化主模型，让它生成更受人类青睐的回答

OpenAI 的 GPT-3.5/4、Claude 都是这么训练出来的。

**适合**：对齐模型行为、改善回复质量、减少有害输出。

### 3. DPO（Direct Preference Optimization，直接偏好优化）

RLHF 的简化版，省掉了奖励模型的中间步骤，直接在偏好数据上优化。

```
输入: "怎么写一个快速排序？"
偏好数据：
  回答A（更好）→ "快速排序的核心是分治..."
  回答B（更差）→ "先选一个基准..."
```

DPO 直接在偏好对上训练，比 RLHF 更稳定、成本更低，已成为行业主流。

**适合**：替代 RLHF，训练风格更可控的模型。

---

## 全量微调 vs 参数高效微调

### 全量微调

把模型所有参数都更新。以 7B 模型为例，需要更新约 70 亿个参数。

**优点**：效果最好，模型完全内化新能力
**缺点**：
- 需要强大的 GPU 资源（多卡 A100/H100）
- 训练成本高（一次训练可能数千到数万美元）
- 一个任务需要一个模型，存储成本爆炸

### 参数高效微调（PEFT）

只更新模型中很小一部分参数，冻结大部分权重。2024 年后成为主流方案。

**主流方法对比：**

| 方法 | 原理 | 可训练参数比例 | 效果 | 硬件要求 |
|------|------|--------------|------|---------|
| **LoRA** | 冻结原权重，在学习过程中注入低秩矩阵 | 0.1%-1% | 接近全量 | 单张 48GB GPU 即可 |
| **QLoRA** | LoRA + 4-bit 量化 | 0.1%-1% | 接近 LoRA | 单张 24GB GPU 可行 |
| **Adapters** | 在每层插入小型适配器模块 | 1%-3% | 接近 LoRA | 中等 |
| **Prefix Tuning** | 只训练前缀向量 | <0.1% | 较弱 | 低 |
| **Prompt Tuning** | 只训练 soft prompt 嵌入 | <0.1% | 最弱 | 最低 |

**结论**：绝大多数场景选 **QLoRA**，性价比最高。

---

## LoRA 原理通俗解释

LoRA（Low-Rank Adaptation）的核心思想：**不直接改大模型的权重，而是用一个小的"补丁"叠加在原权重上。**

```
原始权重 W (7B 参数，冻结不动)
    │
    ▼
新增小矩阵 A × B（可训练，秩 r 很小）
    │
    ▼
W + ΔW = W + (A × B)  →  这就是微调后的权重
```

假设原矩阵是 4096 x 4096，LoRA 的秩 r=8：
- 矩阵 A：4096 x 8 = 32768 个参数
- 矩阵 B：8 x 4096 = 32768 个参数
- 总共只需训练 65536 个参数，而原模型有 160 亿个参数
- **训练参数占比不到 0.05%**

为什么低秩有效？因为大模型学到的知识虽然多，但**特定任务的调整方向其实是低维的**——你不需要改所有参数，只需要在少数几个方向上做微调。

---

## QLoRA：在消费级显卡上微调

QLoRA 在 LoRA 的基础上再加一步：**把原模型量化到 4-bit**。

```
FP16 模型 (2 字节/参数)
    │
    ▼
NF4 量化 (4-bit = 0.5 字节/参数)
    │
    ▼
保持量化权重冻结，只训练 LoRA 适配器
    │
    ▼
推理时反量化回 FP16，效果几乎无损
```

**效果**：一个 7B 模型从 FP16 的 14GB 降到 4-bit 的 3.5GB，可以在 RTX 4090（24GB）甚至 RTX 3090（24GB）上微调。

---

## 实战：用 QLoRA 微调一个客服模型

### 第一步：准备数据

数据格式用 JSONL，每行一条对话：

```json
{"instruction": "订单 ORD-2024-001 的发货状态是什么？", "input": "", "output": "订单 ORD-2024-001 已于 2026-08-10 发货，预计 2026-08-12 到达。"}
{"instruction": "我想退货", "input": "", "output": "请问您订单号是多少？我需要帮您查询订单状态，确认是否符合退货条件。"}
{"instruction": "你们的产品质量太差了", "input": "", "output": "非常抱歉给您带来不好的体验。请您描述一下具体遇到的问题，我会尽力帮您解决。"}
```

**数据质量原则：**
- 至少 500-1000 条高质量数据（太少效果不明显，太多过拟合风险高）
- 数据要覆盖你业务的主要场景
- 避免噪声数据（错别字、格式错误、无关内容）
- 每条数据长度控制在 500 tokens 以内

### 第二步：选择基座模型

国产模型首选（API 免费、支持中文、社区活跃）：

| 模型 | 参数量 | 适合场景 | 硬件要求（4-bit） |
|------|--------|---------|-----------------|
| **Qwen2.5-7B-Instruct** | 7B | 通用首选，综合能力最强 | 8GB+ VRAM |
| **Qwen2.5-14B-Instruct** | 14B | 需要更强能力 | 16GB+ VRAM |
| **DeepSeek-R1-Distill-7B** | 7B | 推理能力强的场景 | 8GB+ VRAM |
| **GLM-4-9B-Chat** | 9B | 中文场景优化 | 10GB+ VRAM |
| **Qwen2.5-3B-Instruct** | 3B | 资源有限/边缘部署 | 6GB+ VRAM |

### 第三步：训练代码

使用 Hugging Face 的 `trl` 库：

```python
from transformers import AutoModelForCausalLM, AutoTokenizer, TrainingArguments
from trl import SFTTrainer
from datasets import Dataset

# 加载模型和分词器（4-bit 量化）
model_name = "Qwen/Qwen2.5-7B-Instruct"
model = AutoModelForCausalLM.from_pretrained(
    model_name,
    quantize_config=BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=torch.float16
    ),
    device_map="auto"
)
tokenizer = AutoTokenizer.from_pretrained(model_name)

# 准备数据
data = [
    {"instruction": "订单 ORD-2024-001 的发货状态是什么？", "input": "", "output": "订单 ORD-2024-001 已于 2026-08-10 发货..."},
    # ... 更多数据
]
dataset = Dataset.from_list(data)

# 格式化数据为模型输入格式
def format_example(example):
    text = f"Below is an instruction that describes a task. Write a response that appropriately completes the request.\n\n### Instruction:\n{example['instruction']}\n\n### Response:\n{example['output']}"
    return {"text": text}

dataset = dataset.map(format_example)

# 配置 LoRA 参数
from peft import LoraConfig, get_peft_model
lora_config = LoraConfig(
    r=16,                    # 秩：16 是常用值，越高表达力越强但越慢
    lora_alpha=32,           # 缩放系数：通常是 r 的 2 倍
    lora_dropout=0.05,       # Dropout 防止过拟合
    target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],  # Qwen 的目标层
    task_type="CAUSAL_LM",
)
model = get_peft_model(model, lora_config)
model.print_trainable_parameters()  # 应显示约 0.5% 参数可训练

# 训练
training_args = TrainingArguments(
    output_dir="./qwen-customer-service",
    num_train_epochs=3,            # 3 轮通常足够
    per_device_train_batch_size=4, # 根据显存调整
    gradient_accumulation_steps=8, # 梯度累积模拟大 batch
    learning_rate=2e-4,            # QLoRA 常用学习率
    fp16=True,
    logging_steps=10,
    save_strategy="epoch",
    evaluation_strategy="epoch",
)

trainer = SFTTrainer(
    model=model,
    train_dataset=dataset,
    tokenizer=tokenizer,
    args=training_args,
    dataset_text_field="text",
    max_seq_length=512,
)
trainer.train()
trainer.save_model("./qwen-customer-service")
```

### 第四步：推理测试

```python
from peft import PeftModel

# 加载基座模型（4-bit）
base_model = AutoModelForCausalLM.from_pretrained(
    "Qwen/Qwen2.5-7B-Instruct",
    quantize_config=BitsAndBytesConfig(load_in_4bit=True),
    device_map="auto"
)
tokenizer = AutoTokenizer.from_pretrained("Qwen/Qwen2.5-7B-Instruct")

# 加载 LoRA 适配器
model = PeftModel.from_pretrained(base_model, "./qwen-customer-service")

# 测试
messages = [{"role": "user", "content": "我的订单还没收到，怎么办？"}]
text = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
inputs = tokenizer(text, return_tensors="pt").to(model.device)
outputs = model.generate(**inputs, max_new_tokens=256, temperature=0.7)
response = tokenizer.decode(outputs[0], skip_special_tokens=True)
print(response)
```

### 第五步：合并权重（可选）

如果要在生产环境部署，建议把 LoRA 适配器合并到基座模型中，避免推理时额外开销：

```python
model = model.merge_and_unload()
model.save_pretrained("./qwen-customer-service-merged")
tokenizer.save_pretrained("./qwen-customer-service-merged")
```

合并后的模型可以直接用 `vLLM`、`Ollama` 部署，推理速度与原始模型一样。

---

## 常见坑与避坑指南

### 1. 数据太少，效果不明显

**症状**：微调后模型回答和没微调差不多。
**原因**：数据量不足或数据质量差。
**解决**：至少准备 500 条以上高质量数据。可以用大模型生成训练数据，再用人工审核。

### 2. 过拟合

**症状**：训练集上表现很好，但新问题上回答变差了（原来的通用能力退化）。
**原因**：训练轮次太多或数据太少。
**解决**：
- 减少训练轮次（2-3 轮通常够了）
- 增大 `lora_dropout`（0.05-0.1）
- 增加训练数据多样性
- 使用更小的学习率（1e-4 到 5e-4）

### 3. 灾难性遗忘

**症状**：微调后模型在特定任务上变强了，但通用对话能力明显下降（比如不会正常聊天了）。
**原因**：训练数据太单一，模型只学会了这一件事。
**解决**：在训练数据中加入 20%-30% 的通用对话数据，保持模型的通用能力。

### 4. 训练不稳定 / Loss 不下降

**症状**：训练过程中 Loss 剧烈波动或不下降。
**原因**：学习率太高、batch size 太小、数据格式错误。
**解决**：
- 学习率从 2e-4 降到 1e-4
- 增大 `gradient_accumulation_steps`
- 检查数据中是否有异常字符或过长的文本

### 5. 推理速度比预期慢

**症状**：微调后推理延迟增加。
**原因**：LoRA 适配器增加了计算量，或者量化导致数值精度问题。
**解决**：
- 合并 LoRA 权重后再部署（`merge_and_unload`）
- 使用 vLLM 推理框架，支持 PagedAttention 加速
- 评估不同秩（r=8/16/32）的延迟-质量平衡

---

## 微调后的部署

### 本地部署（Ollama）

```bash
# 将合并后的模型转换为 GGUF 格式
python convert-hf-to-gguf.py qwen-customer-service-merged --outfile qwen-customer-service.Q4_K_M.gguf

# 用 Ollama 运行
ollama create qwen-customer-service -f Modelfile
# 然后 ollama run qwen-customer-service
```

### 云端部署（vLLM）

```bash
# 启动 vLLM 服务
python -m vllm.entrypoints.openai.api_server \
    --model ./qwen-customer-service-merged \
    --port 8000 \
    --max-model-len 4096

# 调用（与 OpenAI 兼容）
curl http://localhost:8000/v1/chat/completions \
    -H "Content-Type: application/json" \
    -d '{"model": "qwen-customer-service", "messages": [{"role": "user", "content": "我的订单还没收到"}]}'
```

vLLM 支持连续批处理（Continuous Batching）和 PagedAttention，推理吞吐比原始 Hugging Face 高 2-4 倍。

---

## 微调的边界：什么时候不该微调

1. **知识会频繁变化** → 用 RAG，微调会把过时知识固化到模型里
2. **需要模型输出精确数字/代码** → 微调不解决这个问题，Prompt + 工具调用更可靠
3. **数据量 < 100 条** → 效果微乎其微，不值得训练
4. **只是想让语气更友好** → 改 Prompt 就够了
5. **每次用户请求不同领域** → 多领域微调会导致模型"记忆混乱"

---

## 总结

微调的本质是**用数据换能力**——你把领域知识塞进模型参数，换取更稳定、更一致的输出。但它有明确边界：

- **Prompt** 解决"怎么说"
- **RAG** 解决"知道什么"
- **微调** 解决"怎么做"和"像谁"

三者不是互斥的，最强大的系统是三者组合：微调过的模型 + RAG 补充实时知识 + 精心设计的 Prompt 引导输出。

从 QLoRA + 500 条数据开始，用一台 24GB 显存的显卡就能完成第一次微调。跑通流程比追求完美更重要。
