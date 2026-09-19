import { CourseService } from '@modules/course';
import { RoomService } from '@modules/room';
import { RoomMembershipService } from '@modules/room-membership';
import { UserService } from '@modules/user';
import { Injectable } from '@nestjs/common';
import { EntityId } from '@shared/domain/types';
import { BoardExternalReference, BoardExternalReferenceType } from '../../../domain';
import { CourseBoardContext, CourseBoardContextData, CourseUserInfo } from './course-board-context';
import { PreparedBoardContext } from './prepared-board-context.interface';
import { RoomBoardContext } from './room-board-context';
import { UserBoardContext } from './user-board-context';

/**
 * Resolves context references into PreparedBoardContext instances.
 * Handles fetching of required data (Room, Course, etc.) and constructs
 * the appropriate context implementation.
 *
 * For Room contexts, fetches Room and RoomAuthorizable in parallel for efficiency.
 */
@Injectable()
export class BoardContextResolverService {
	constructor(
		private readonly courseService: CourseService,
		private readonly roomService: RoomService,
		private readonly roomMembershipService: RoomMembershipService,
		private readonly userService: UserService
	) {}

	/**
	 * Resolves a board's external reference into a PreparedBoardContext.
	 * Fetches all required data upfront so subsequent operations are synchronous.
	 */
	public async resolve(contextRef: BoardExternalReference): Promise<PreparedBoardContext> {
		switch (contextRef.type) {
			case BoardExternalReferenceType.Room:
				return await this.resolveRoomContext(contextRef.id);

			case BoardExternalReferenceType.Course:
				return await this.resolveCourseContext(contextRef.id);

			case BoardExternalReferenceType.User:
				return this.resolveUserContext(contextRef.id);

			default:
				throw new Error(`Unknown context type: '${contextRef.type as string}'`);
		}
	}

	private async resolveRoomContext(roomId: string): Promise<RoomBoardContext> {
		// Fetch Room and RoomAuthorizable in parallel for efficiency
		const [room, roomAuthorizable] = await Promise.all([
			this.roomService.getSingleRoom(roomId),
			this.roomMembershipService.getRoomAuthorizable(roomId),
		]);

		const memberIds = roomAuthorizable.members.map((member) => member.userId);
		const userNames = new Map<EntityId, { firstName?: string; lastName?: string }>();

		if (memberIds.length > 0) {
			const users = await this.userService.getUserEntitiesWithRoles(memberIds);
			users.forEach((user) => {
				userNames.set(user.id, { firstName: user.firstName, lastName: user.lastName });
			});
		}

		return new RoomBoardContext(room, roomAuthorizable, userNames);
	}

	private async resolveCourseContext(courseId: string): Promise<CourseBoardContext> {
		const course = await this.courseService.findById(courseId);

		const data: CourseBoardContextData = {
			teachers: course.getTeachersList().map((user): CourseUserInfo => {
				return {
					userId: user.id,
					firstName: user.firstName,
					lastName: user.lastName,
				};
			}),
			substitutionTeachers: course.getSubstitutionTeachersList().map((user): CourseUserInfo => {
				return {
					userId: user.id,
					firstName: user.firstName,
					lastName: user.lastName,
				};
			}),
			students: course.getStudentsList().map((user): CourseUserInfo => {
				return {
					userId: user.id,
					firstName: user.firstName,
					lastName: user.lastName,
				};
			}),
		};

		return new CourseBoardContext(data);
	}

	private resolveUserContext(userId: string): UserBoardContext {
		// No async work needed for user context
		return new UserBoardContext(userId);
	}
}
