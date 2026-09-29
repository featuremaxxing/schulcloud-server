import { ObjectId } from '@mikro-orm/mongodb';
import { BaseFactory } from '@testing/factory/base.factory';
import { PollAnswerMode, PollChartType, type PollElementProps, PollStatus, ROOT_PATH } from '../domain';
import { PollElement } from '../domain/poll-element.do';

export const pollElementFactory = BaseFactory.define<PollElement, PollElementProps>(PollElement, ({ sequence }) => {
	return {
		id: new ObjectId().toHexString(),
		path: ROOT_PATH,
		level: 0,
		position: 0,
		children: [],
		title: `poll #${sequence}`,
		questions: [
			{
				id: new ObjectId().toHexString(),
				text: `question #${sequence}`,
				answerMode: PollAnswerMode.SINGLE,
				chartType: PollChartType.BAR,
				options: [
					{ id: new ObjectId().toHexString(), text: 'option a' },
					{ id: new ObjectId().toHexString(), text: 'option b' },
				],
			},
		],
		isAnonymous: false,
		showResultsLive: false,
		pollStatus: PollStatus.DRAFT,
		createdAt: new Date(),
		updatedAt: new Date(),
	};
});
