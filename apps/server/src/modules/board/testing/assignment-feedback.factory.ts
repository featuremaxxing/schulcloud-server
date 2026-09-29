import { ObjectId } from '@mikro-orm/mongodb';
import { BaseFactory } from '@testing/factory/base.factory';
import { type AssignmentFeedbackProps, ROOT_PATH } from '../domain';
import { AssignmentFeedback } from '../domain/assignment-feedback.do';

export const assignmentFeedbackFactory = BaseFactory.define<AssignmentFeedback, AssignmentFeedbackProps>(
	AssignmentFeedback,
	() => {
		return {
			id: new ObjectId().toHexString(),
			path: ROOT_PATH,
			level: 0,
			position: 0,
			children: [],
			createdAt: new Date(),
			updatedAt: new Date(),
		};
	}
);
