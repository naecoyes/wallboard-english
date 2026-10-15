// Curated meanings for the AI/security presentation; not global acronym replacements.
export const TECHNICAL_VOCABULARY = {
  llm: ['', 'n. 大语言模型（Large Language Model）', 'n. Large Language Model: an AI model trained on large amounts of text to understand and generate language.'],
  ai: ['', 'n. 人工智能（Artificial Intelligence）', 'n. Artificial intelligence: computer systems that perform tasks requiring human-like intelligence.'],
  api: ['', 'n. 应用程序编程接口（Application Programming Interface）', 'n. Application Programming Interface: a defined interface through which software components communicate.'],
  ip: ['', 'n. 网际协议；文中 IPs 指 IP 地址', 'n. Internet Protocol; in this asset inventory, IPs means IP addresses identifying network hosts.'],
  ips: ['', 'n. IP 地址（此处指资产列表中的网络地址）', 'n. IP addresses: network addresses identifying hosts in the asset inventory.'],
  token: ['', 'n. 词元：模型处理文本的基本单位；Token 用量用于统计模型输入输出', 'n. A unit of text processed by a language model; token usage measures model input and output.'],
  tokens: ['', 'n. 词元（token 的复数）：模型处理文本的基本单位', 'n. Units of text processed by a language model.'],
};
export function isTechnicalPresentation(article) {
  return /AI[- ]Pentester/i.test(article.title);
}
