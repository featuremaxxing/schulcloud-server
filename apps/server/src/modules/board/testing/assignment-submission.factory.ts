import { ObjectId } from '@mikro-orm/mongodb';
import { BaseFactory } from '@testing/factory/base.factory';
import { type AssignmentSubmissionProps, ROOT_PATH } from '../domain';
import { AssignmentSubmission } from '../domain/assignment-submission.do';

export const assignmentSubmissionFactory = BaseFactory.define<AssignmentSubmission, AssignmentSubmissionProps>(
	AssignmentSubmission,
	() => {
		return {
			id: new ObjectId().toHexString(),
			path: ROOT_PATH,
			level: 0,
			position: 0,
			children: [],
			userId: new ObjectId().toHexString(),
			createdAt: new Date(),
			updatedAt: new Date(),
		};
	}
);
