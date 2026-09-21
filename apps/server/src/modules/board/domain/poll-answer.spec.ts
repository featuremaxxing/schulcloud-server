import { normalizePollAnswers } from './poll-answer';
import { pollElementFactory } from '../testing';
import { PollAnswerMode, PollChartType } from './types';

describe(normalizePollAnswers.name, () => {
	const buildElement = () =>
		pollElementFactory.build({
			questions: [
				{
					id: 'single-question',
					text: 'single choice',
					answerMode: PollAnswerMode.SINGLE,
					chartType: PollChartType.BAR,
					options: [
						{ id: 'single-a', text: 'a' },
						{ id: 'single-b', text: 'b' },
					],
				},
				{
					id: 'multiple-question',
					text: 'multiple choice',
					answerMode: PollAnswerMode.MULTIPLE,
					chartType: PollChartType.BAR,
					options: [
						{ id: 'multi-a', text: 'a' },
						{ id: 'multi-b', text: 'b' },
						{ id: 'multi-c', text: 'c' },
					],
				},
				{
					id: 'text-question',
					text: 'free text',
					answerMode: PollAnswerMode.TEXT,
					chartType: PollChartType.BAR,
					options: [],
				},
			],
		});

	it('should keep a single valid selection for a single-choice question', () => {
		const element = buildElement();

		const result = normalizePollAnswers(element, [{ questionId: 'single-question', selectedOptionIds: ['single-a'] }]);

		expect(result).toEqual([{ questionId: 'single-question', selectedOptionIds: ['single-a'] }]);
	});

	it('should reduce more than one selected option to just the first for a single-choice question', () => {
		const element = buildElement();

		const result = normalizePollAnswers(element, [
			{ questionId: 'single-question', selectedOptionIds: ['single-a', 'single-b'] },
		]);

		expect(result).toEqual([{ questionId: 'single-question', selectedOptionIds: ['single-a'] }]);
	});

	it('should drop option ids that do not belong to the question', () => {
		const element = buildElement();

		const result = normalizePollAnswers(element, [
			{ questionId: 'single-question', selectedOptionIds: ['does-not-exist'] },
		]);

		expect(result).toEqual([{ questionId: 'single-question', selectedOptionIds: [] }]);
	});

	it('should keep every valid, deduplicated option for a multiple-choice question', () => {
		const element = buildElement();

		const result = normalizePollAnswers(element, [
			{ questionId: 'multiple-question', selectedOptionIds: ['multi-a', 'multi-a', 'multi-c', 'unknown'] },
		]);

		expect(result).toEqual([{ questionId: 'multiple-question', selectedOptionIds: ['multi-a', 'multi-c'] }]);
	});

	it('should force selectedOptionIds empty for a text question, even if some were sent', () => {
		const element = buildElement();

		const result = normalizePollAnswers(element, [
			{ questionId: 'text-question', selectedOptionIds: ['single-a'], textAnswer: 'my answer' },
		]);

		expect(result).toEqual([{ questionId: 'text-question', selectedOptionIds: [], textAnswer: 'my answer' }]);
	});

	it('should drop an answer for a question id the poll does not have', () => {
		const element = buildElement();

		const result = normalizePollAnswers(element, [{ questionId: 'unknown-question', selectedOptionIds: [] }]);

		expect(result).toEqual([]);
	});

	it('should keep only the first answer when the same question id is sent twice', () => {
		const element = buildElement();

		const result = normalizePollAnswers(element, [
			{ questionId: 'single-question', selectedOptionIds: ['single-a'] },
			{ questionId: 'single-question', selectedOptionIds: ['single-b'] },
		]);

		expect(result).toEqual([{ questionId: 'single-question', selectedOptionIds: ['single-a'] }]);
	});

	it('should omit a question that was not answered at all', () => {
		const element = buildElement();

		const result = normalizePollAnswers(element, [{ questionId: 'single-question', selectedOptionIds: ['single-a'] }]);

		expect(result.map((answer) => answer.questionId)).toEqual(['single-question']);
	});

	it('should return an empty array for no answers', () => {
		const element = buildElement();

		expect(normalizePollAnswers(element, [])).toEqual([]);
	});
});
