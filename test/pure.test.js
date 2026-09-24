/**
 * 纯函数单测：请求构造（buildQuestion/buildPayload）与响应压缩（summarize）。
 * 不发网络请求——API 形状以 lib/index.js 内联的文档契约为准。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildQuestion, buildPayload, summarize } from '../lib/index.js';

//#region buildQuestion

test('buildQuestion: 省略 type 时默认 noul', () => {
	assert.deepEqual(
		buildQuestion({ question: '这条消息是否紧急?' }),
		{ type: 'noul', instructions: '这条消息是否紧急?' },
	);
});

test('buildQuestion: choice 把 options 展开为 criteria 键（值全 null）', () => {
	assert.deepEqual(
		buildQuestion({ type: 'choice', question: '路由到哪个团队?', options: ['billing', 'technical', 'sales'] }),
		{
			type: 'choice',
			instructions: '路由到哪个团队?',
			criteria: { billing: null, technical: null, sales: null },
		},
	);
});

test('buildQuestion: choice 缺 options / 只有一个选项时报错', () => {
	assert.throws(() => buildQuestion({ type: 'choice', question: 'q' }), /options/);
	assert.throws(() => buildQuestion({ type: 'choice', question: 'q', options: ['only'] }), /options/);
});

test('buildQuestion: score 的 levels 保序进入 criteria 数组', () => {
	assert.deepEqual(
		buildQuestion({ type: 'score', question: '愤怒程度?', levels: ['Calm', 'Frustrated', 'Very angry'] }),
		{ type: 'score', instructions: '愤怒程度?', criteria: ['Calm', 'Frustrated', 'Very angry'] },
	);
});

test('buildQuestion: score 缺 levels 报错', () => {
	assert.throws(() => buildQuestion({ type: 'score', question: 'q' }), /levels/);
});

test('buildQuestion: 未知类型报错并列出合法值', () => {
	assert.throws(() => buildQuestion({ type: 'boolean', question: 'q' }), /noul\/choice\/score/);
});

//#endregion

//#region buildPayload

test('buildPayload: 单题请求形状 {model, state, questions:{decision}}', () => {
	assert.deepEqual(
		buildPayload({ state: '发票失败了', question: '紧急吗?' }, 'jev-latest'),
		{
			model: 'jev-latest',
			state: '发票失败了',
			questions: { decision: { type: 'noul', instructions: '紧急吗?' } },
		},
	);
});

test('buildPayload: 空 state / 空 question 均报错', () => {
	assert.throws(() => buildPayload({ state: '', question: 'q' }), /state/);
	assert.throws(() => buildPayload({ state: 's', question: '' }), /question/);
});

test('buildPayload: choice 的 criteria 键经 JSON 序列化仍为选项字符串', () => {
	const payload = buildPayload(
		{ state: 's', question: 'q', type: 'choice', options: ['a', 'b'] },
		'jev-latest',
	);
	const sent = JSON.parse(JSON.stringify(payload));
	assert.deepEqual(Object.keys(sent.questions.decision.criteria), ['a', 'b']);
});

//#endregion

//#region summarize

const USAGE = { input_tokens: 12, output_tokens: 3 };

test('summarize: noul → answer 为是概率，不带 probabilities/confidence 缺省省略', () => {
	assert.deepEqual(
		summarize({
			model: 'jev-1.13.0',
			usage: USAGE,
			answers: { decision: { type: 'noul', noul: 0.82 } },
		}),
		{ model: 'jev-1.13.0', type: 'noul', answer: 0.82, usage: USAGE },
	);
});

test('summarize: choice → answer 为选中项，probabilities 为浅拷贝', () => {
	const out = summarize({
		model: 'jev-1.13.0',
		usage: USAGE,
		answers: { decision: { type: 'choice', choice: 'billing', confidence: 0.9, probabilities: { billing: 0.7, technical: 0.2, sales: 0.1 } } },
	});
	assert.equal(out.answer, 'billing');
	assert.equal(out.confidence, 0.9);
	assert.deepEqual(out.probabilities, { billing: 0.7, technical: 0.2, sales: 0.1 });
});

test('summarize: score → answer 为概率加权分值', () => {
	const out = summarize({
		model: 'jev-1.13.0',
		usage: USAGE,
		answers: { decision: { type: 'score', score: 1.35, confidence: 0.66, probabilities: { '0': 0.3, '1': 0.4, '2': 0.3 } } },
	});
	assert.equal(out.answer, 1.35);
	assert.equal(out.type, 'score');
});

test('summarize: 缺 answers.decision 报错并带上响应片段', () => {
	assert.throws(() => summarize({ model: 'm', answers: {} }), /answers\.decision/);
});

test('summarize: usage 字段缺失时整个省略（schema 中可选），model 非字符串时为 unknown', () => {
	const out = summarize({ answers: { decision: { type: 'noul', noul: 0.1 } } });
	assert.equal(out.model, 'unknown');
	assert.equal(out.usage, undefined);
	assert.deepEqual(
		summarize({ usage: {}, answers: { decision: { type: 'noul', noul: 0.1 } } }).usage,
		{ input_tokens: 0, output_tokens: 0 },
	);
});

//#endregion
