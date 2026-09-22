import { isAnsweredPollQuestion, mergePollAnswers, normalizePollAnswers } from './poll-answer';
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

	describe(isAnsweredPollQuestion.name, () => {
		it('should be false for undefined', () => {
			expect(isAnsweredPollQuestion(undefined)).toBe(false);
		});

		it('should be false for an answer with no selected options and no text', () => {
			expect(isAnsweredPollQuestion({ questionId: 'q', selectedOptionIds: [] })).toBe(false);
		});

		it('should be false for an answer with only whitespace text', () => {
			expect(isAnsweredPollQuestion({ questionId: 'q', selectedOptionIds: [], textAnswer: '   ' })).toBe(false);
		});

		it('should be true for an answer with at least one selected option', () => {
			expect(isAnsweredPollQuestion({ questionId: 'q', selectedOptionIds: ['a'] })).toBe(true);
		});

		it('should be true for an answer with non-empty text', () => {
			expect(isAnsweredPollQuestion({ questionId: 'q', selectedOptionIds: [], textAnswer: 'hi' })).toBe(true);
		});
	});

	describe(mergePollAnswers.name, () => {
		it('should let the incoming answer win outright when allowVoteChange is true', () => {
			const element = buildElement();
			element.allowVoteChange = true;
			const existing = [{ questionId: 'single-question', selectedOptionIds: ['single-a'] }];
			const incoming = [{ questionId: 'single-question', selectedOptionIds: ['single-b'] }];

			expect(mergePollAnswers(element, existing, incoming)).toEqual(incoming);
		});

		it('should keep the existing answer for an already-answered question when allowVoteChange is false', () => {
			const element = buildElement();
			element.allowVoteChange = false;
			const existing = [{ questionId: 'single-question', selectedOptionIds: ['single-a'] }];
			const incoming = [{ questionId: 'single-question', selectedOptionIds: ['single-b'] }];

			const result = mergePollAnswers(element, existing, incoming);

			expect(result.find((a) => a.questionId === 'single-question')).toEqual(existing[0]);
		});

		it('should take the incoming answer for a question that was not answered yet', () => {
			const element = buildElement();
			element.allowVoteChange = false;
			const existing = [{ questionId: 'single-question', selectedOptionIds: [] }];
			const incoming = [{ questionId: 'single-question', selectedOptionIds: ['single-a'] }];

			const result = mergePollAnswers(element, existing, incoming);

			expect(result.find((a) => a.questionId === 'single-question')).toEqual(incoming[0]);
		});

		it('should fill in a question the existing vote has no entry for at all (newly added question)', () => {
			const element = buildElement();
			element.allowVoteChange = false;
			const existing = [{ questionId: 'single-question', selectedOptionIds: ['single-a'] }];
			const incoming = [
				{ questionId: 'single-question', selectedOptionIds: ['single-a'] },
				{ questionId: 'multiple-question', selectedOptionIds: ['multi-a'] },
			];

			const result = mergePollAnswers(element, existing, incoming);

			expect(result.find((a) => a.questionId === 'multiple-question')).toEqual({
				questionId: 'multiple-question',
				selectedOptionIds: ['multi-a'],
			});
		});

		it('should return one entry per question on the element', () => {
			const element = buildElement();
			const result = mergePollAnswers(element, [], []);

			expect(result.map((a) => a.questionId)).toEqual(['single-question', 'multiple-question', 'text-question']);
		});
	});
});
