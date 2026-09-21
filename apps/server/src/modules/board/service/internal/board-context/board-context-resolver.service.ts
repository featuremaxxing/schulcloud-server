import { CourseService } from '@modules/course';
import { RoleName } from '@modules/role';
import { RoomService } from '@modules/room';
import { RoomMembershipService } from '@modules/room-membership';
import { UserService } from '@modules/user';
import { Injectable } from '@nestjs/common';
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
	 * Resolves a board's external reference into a PreparedBoardContext. Fetches the data every
	 * operation needs upfront (board configuration, membership/roles); data only some operations
	 * need (user names/school roles, for a Room context) is deferred - see resolveRoomContext.
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

		// Room memberships carry no user names or school roles (e.g. the assignment teacher
		// overview shows student names; isStudentMember/isTeacherMember need the school role to
		// tell a teacher who is only a room viewer apart from an actual student). Loading them is
		// a separate DB round-trip that resolve() used to pay on every single call, even for the
		// (large majority of) board operations that never read a name or school role - deferred
		// into this closure instead, which RoomBoardContext calls at most once, only if its
		// getUsersWithBoardRoles() is actually invoked.
		const loadUserInfo = async (): Promise<
			Map<string, { firstName?: string; lastName?: string; schoolRoleNames?: RoleName[] }>
		> => {
			const memberIds = roomAuthorizable.members.map((member) => member.userId);
			const users = memberIds.length > 0 ? await this.userService.getUserEntitiesWithRoles(memberIds) : [];

			return new Map(
				users.map((user) => [
					user.id,
					{
						firstName: user.firstName,
						lastName: user.lastName,
						schoolRoleNames: user.roles.getItems().map((role) => role.name),
					},
				])
			);
		};

		return new RoomBoardContext(room, roomAuthorizable, loadUserInfo);
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
