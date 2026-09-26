/**
 * dsh-jev-decide — 把 TypeSafe Jev（System One 决策模型）接入 DSH 的 agent 工具集。
 *
 * Jev 不生成文本：它对 `state` 回答类型化问题并返回校准过的概率
 * （noul=是/否概率，choice=选项+分布，score=有序评分+分布）。
 * 本插件把它注册为一个 agent 工具 `jev_decide`，适用于：
 * 路由、分类、紧急度分级、guardrail 检查等"快而准的判断"场景，
 * 而不是让对话模型凭感觉猜。
 *
 * API: POST {baseUrl}/systemone（官方文档 https://docs.typesafe.ai/api）
 *   - 401/422/429/529 语义见文档；429/529 做一次短退避重试。
 *
 * 凭证解析顺序（第一个非空者生效）：
 *   1. cordis patch / 插件 config 的 `apiKey` 字段
 *   2. 环境变量 TYPESAFE_API_KEY
 *   3. ~/.dsh/.credentials.yaml refs.TYPESAFE_AI_API_KEY（与 DSH 凭证缝同源，避免明文双份）
 *
 * 配置（cordis patch 的 config 或 $DSH_HOME/plugins/dsh-jev-decide/config.json）：
 *   baseUrl   默认 https://api.typesafe.ai/v1
 *   model     默认 jev-latest
 *   timeoutMs 默认 15000
 *   apiKey    可选，见上方解析顺序
 */
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { defineTool } from '@deepseek-ai/dsh-tools';

export const name = 'dsh-jev-decide';
export const inject = ['tools'];

const DEFAULTS = Object.freeze({
	baseUrl: 'https://api.typesafe.ai/v1',
	model: 'jev-latest',
	timeoutMs: 15000,
});

//#region ── 纯函数（导出仅为可测性）────────────────────────────────

/** 依据工具入参构造一个 TypeSafe question 对象。校验失败抛 Error。 */
export function buildQuestion(args) {
	const type = args.type ?? 'noul';
	switch (type) {
		case 'noul': {
			const q = { type, instructions: args.question };
			if (args.yes != null || args.no != null) {
				q.criteria = { true: args.yes ?? null, false: args.no ?? null };
			}
			return q;
		}
		case 'choice': {
			if (!Array.isArray(args.options) || args.options.length < 2) {
				throw new Error('jev_decide: type=choice 需要 options（≥2 个选项字符串）');
			}
			const criteria = {};
			for (const option of args.options) criteria[option] = null;
			return { type, instructions: args.question, criteria };
		}
		case 'score': {
			if (!Array.isArray(args.levels) || args.levels.length < 2) {
				throw new Error('jev_decide: type=score 需要 levels（≥2 个有序等级描述）');
			}
			return { type, instructions: args.question, criteria: [...args.levels] };
		}
		default:
			throw new Error(`jev_decide: 未知 question 类型 ${JSON.stringify(type)}（应为 noul/choice/score）`);
	}
}

/** 构造 /v1/systemone 请求体。 */
export function buildPayload(args, model) {
	if (typeof args.state !== 'string' || args.state.length === 0) {
		throw new Error('jev_decide: state 不能为空');
	}
	if (typeof args.question !== 'string' || args.question.length === 0) {
		throw new Error('jev_decide: question 不能为空');
	}
	return {
		model,
		state: args.state,
		questions: { decision: buildQuestion(args) },
	};
}

/** 把 /v1/systemone 响应压缩成工具输出（answers.decision + usage）。 */
export function summarize(response) {
	const answer = response?.answers?.decision;
	if (answer === undefined || answer === null) {
		throw new Error(`jev_decide: 响应缺少 answers.decision：${JSON.stringify(response).slice(0, 300)}`);
	}
	const type = answer.type;
	const output = {
		model: typeof response.model === 'string' ? response.model : 'unknown',
		type,
		answer: type === 'noul' ? answer.noul
			: type === 'choice' ? answer.choice
			: type === 'score' ? answer.score
			: answer,
	};
	if (typeof answer.confidence === 'number') output.confidence = answer.confidence;
	if (answer.probabilities !== undefined && answer.probabilities !== null) {
		output.probabilities = { ...answer.probabilities };
	}
	if (response.usage !== undefined && response.usage !== null) {
		output.usage = {
			input_tokens: response.usage.input_tokens ?? 0,
			output_tokens: response.usage.output_tokens ?? 0,
		};
	}
	return output;
}

//#endregion

//#region ── 凭证与配置 ────────────────────────────────────────────

function dshHome() {
	return process.env.DSH_HOME || join(homedir(), '.dsh');
}

/** 极简读取 ~/.dsh/.credentials.yaml refs 里的一行引用（避免引入 YAML 依赖）。 */
async function readCredentialRef(ref) {
	try {
		const raw = await readFile(join(dshHome(), '.credentials.yaml'), 'utf8');
		const inRefs = /^refs:\s*$/m.test(raw);
		if (!inRefs) return undefined;
		for (const line of raw.split('\n')) {
			const match = new RegExp(`^\\s{2}${ref}:\\s*(.+?)\\s*$`).exec(line);
			if (match) return match[1];
		}
	} catch {
		/* 文件不存在/不可读 → 视为未配置 */
	}
	return undefined;
}

async function loadPluginFileConfig() {
	try {
		const raw = await readFile(join(dshHome(), 'plugins', name, 'config.json'), 'utf8');
		return JSON.parse(raw);
	} catch {
		return {};
	}
}

async function resolveKey(config) {
	if (typeof config.apiKey === 'string' && config.apiKey.length > 0) return config.apiKey;
	if (typeof process.env.TYPESAFE_API_KEY === 'string' && process.env.TYPESAFE_API_KEY.length > 0) {
		return process.env.TYPESAFE_API_KEY;
	}
	return readCredentialRef('TYPESAFE_AI_API_KEY');
}

//#endregion

export async function apply(ctx, config = {}) {
	const fileConfig = await loadPluginFileConfig();
	const cfg = {
		...DEFAULTS,
		...fileConfig,
		...config,
	};

	ctx.tools.register(defineTool({
		name: 'jev_decide',
		description: [
			'Ask the TypeSafe Jev "System One" decision model a typed question about a state and get a calibrated, structured answer (NOT a chat/text model).',
			'Use for fast decisions: urgency classification, intent routing, guardrails, ranking between options, scoring against a rubric.',
			'type=noul → yes/no probability; type=choice → pick one option (requires options) and returns the full distribution; type=score → rating on ordered levels (requires levels, ≥2).',
		].join(' '),
		parameters: {
			state: {
				type: 'string',
				required: true,
				description: 'The content to evaluate: a message, an email, a log line, a short document… (text only)',
			},
			question: {
				type: 'string',
				required: true,
				description: 'The decision to make, e.g. "Does this message convey urgency?" or "Which team should handle this?"',
			},
			type: {
				type: 'string',
				enum: ['noul', 'choice', 'score'],
				description: 'Question type. Defaults to noul (yes/no probability).',
			},
			options: {
				type: 'array',
				description: 'For type=choice: the option labels (≥2), e.g. ["billing", "technical", "sales"].',
				items: { type: 'string' },
			},
			levels: {
				type: 'array',
				description: 'For type=score: ordered level descriptions from low to high (≥2), e.g. ["Calm", "Frustrated", "Very angry"].',
				items: { type: 'string' },
			},
			yes: {
				type: 'string',
				description: 'For type=noul (optional): what counts as a YES answer, e.g. "The message demands action within 24h.". Sharpens calibration.',
			},
			no: {
				type: 'string',
				description: 'For type=noul (optional): what counts as a NO answer, e.g. "The message is informational only.".',
			},
			model: {
				type: 'string',
				description: 'TypeSafe model id. Defaults to jev-latest (currently jev-1.13.0).',
			},
		},
		output: {
			schema: {
				type: 'object',
				additionalProperties: false,
				properties: {
					model: { type: 'string', required: true },
					type: { type: 'string', required: true },
					answer: {
						required: true,
						oneOf: [
							{ type: 'number', description: 'noul → yes-probability 0..1; score → probability-weighted level value' },
							{ type: 'string', description: 'choice → the chosen option label' },
						],
					},
					confidence: { type: 'number' },
					probabilities: { type: 'object', additionalProperties: true },
					usage: {
						type: 'object',
						additionalProperties: false,
						properties: {
							input_tokens: { type: 'integer' },
							output_tokens: { type: 'integer' },
						},
					},
				},
			},
			render: (_args, value) => [{
				type: 'text',
				text: JSON.stringify(value),
			}],
		},
		timeoutMs: cfg.timeoutMs + 5000,
		async execute(args, exec) {
			const apiKey = await resolveKey(cfg);
			if (!apiKey) {
				throw new Error('jev_decide: 未找到 Typesafe API key（按序检查：插件 config.apiKey → 环境变量 TYPESAFE_API_KEY → ~/.dsh/.credentials.yaml refs.TYPESAFE_AI_API_KEY）');
			}
			const payload = buildPayload(args, typeof args.model === 'string' && args.model.length > 0 ? args.model : cfg.model);
			const url = `${cfg.baseUrl.replace(/\/+$/, '')}/systemone`;

			// 429/529 官方建议退避重试：这里做一次 1s 短退避，共最多 2 次尝试。
			let response;
			for (let attempt = 0; ; attempt++) {
				response = await fetch(url, {
					method: 'POST',
					headers: {
						authorization: `Bearer ${apiKey}`,
						'content-type': 'application/json',
					},
					body: JSON.stringify(payload),
					signal: exec.signal,
				});
				if ((response.status === 429 || response.status === 529) && attempt === 0) {
					await new Promise((resolve) => setTimeout(resolve, 1000));
					continue;
				}
				break;
			}
			if (!response.ok) {
				const body = (await response.text()).slice(0, 300);
				throw new Error(`jev_decide: Typesafe API HTTP ${response.status}: ${body}`);
			}
			return summarize(await response.json());
		},
	}));
}
