import { createMock, type DeepMocked } from '@golevelup/ts-jest';
import { ObjectId } from '@mikro-orm/mongodb';
import { Action, AuthorizationInjectionService } from '@modules/authorization';
import { BoardRoles } from '@modules/board';
import { roleFactory } from '@modules/role/testing';
import { UserService } from '@modules/user';
import { User } from '@modules/user/repo';
import { userFactory } from '@modules/user/testing';
import { Test, type TestingModule } from '@nestjs/testing';
import { Permission } from '@shared/domain/interface';
import { setupEntities } from '@testing/database';
import { studentPermissions, userPermissions } from '@testing/user-role-permissions';
import { type BoardConfiguration } from '../domain';
import {
	assignmentElementFactory,
	assignmentSubmissionFactory,
	boardNodeAuthorizableFactory,
	columnBoardFactory,
	drawingElementFactory,
	fileElementFactory,
	videoConferenceElementFactory,
} from '../testing';
import { BoardNodeRule, type BoardOperation } from './board-node.rule';

describe(BoardNodeRule.name, () => {
	let boardNodeRule: BoardNodeRule;
	let injectionService: AuthorizationInjectionService;
	let userService: DeepMocked<UserService>;

	beforeAll(async () => {
		await setupEntities([User]);

		const module: TestingModule = await Test.createTestingModule({
			providers: [
				BoardNodeRule,
				AuthorizationInjectionService,
				{ provide: UserService, useValue: createMock<UserService>() },
			],
		}).compile();

		boardNodeRule = await module.get(BoardNodeRule);
		injectionService = await module.get(AuthorizationInjectionService);
		userService = await module.get(UserService);
	});

	describe('injection', () => {
		it('should inject itself into authorisation module', () => {
			expect(injectionService.getAuthorizationRules()).toContain(boardNodeRule);
		});
	});

	describe('isApplicable', () => {
		describe('when entity is applicable', () => {
			const setup = () => {
				const user = userFactory.build();
				const anyBoardNode = fileElementFactory.build();
				const columnBoard = columnBoardFactory.build();
				const boardNodeAuthorizable = boardNodeAuthorizableFactory.build({
					users: [],
					id: new ObjectId().toHexString(),
					boardNode: anyBoardNode,
					rootNode: columnBoard,
					boardConfiguration: { isLocked: false },
				});
				return { user, boardNodeAuthorizable };
			};

			it('should return true', () => {
				const { boardNodeAuthorizable, user } = setup();

				const result = boardNodeRule.isApplicable(user, boardNodeAuthorizable);

				expect(result).toStrictEqual(true);
			});
		});

		describe('when entity is not applicable', () => {
			const setup = () => {
				const user = userFactory.build();
				return { user };
			};

			it('should return false', () => {
				const { user } = setup();

				const result = boardNodeRule.isApplicable(user, user);

				expect(result).toStrictEqual(false);
			});
		});
	});

	describe('hasPermission', () => {
		describe('when user has permission', () => {
			const setup = () => {
				const permissionA = 'a' as Permission;
				const permissionB = 'b' as Permission;
				const role = roleFactory.build({ permissions: [permissionA, permissionB] });
				const user = userFactory.buildWithId({ roles: [role] });
				const anyBoardNode = fileElementFactory.build();
				const columnBoard = columnBoardFactory.build();
				const boardNodeAuthorizable = boardNodeAuthorizableFactory.build({
					users: [{ userId: user.id, roles: [BoardRoles.EDITOR] }],
					id: new ObjectId().toHexString(),
					boardNode: anyBoardNode,
					rootNode: columnBoard,
					boardConfiguration: { isLocked: false },
				});

				return { user, boardNodeAuthorizable };
			};

			it('should return "true"', () => {
				const { user, boardNodeAuthorizable } = setup();

				const res = boardNodeRule.hasPermission(user, boardNodeAuthorizable, {
					action: Action.read,
					requiredPermissions: [],
				});

				expect(res).toBe(true);
			});
		});

		describe('when user has a boardPermission permission', () => {
			const setup = () => {
				const user = userFactory.buildWithId();
				const anyBoardNode = fileElementFactory.build();
				const columnBoard = columnBoardFactory.build();
				const boardNodeAuthorizable = boardNodeAuthorizableFactory.build({
					users: [{ userId: user.id, roles: [BoardRoles.EDITOR] }], // Editor has BOARD_VIEW permission
					id: new ObjectId().toHexString(),
					boardNode: anyBoardNode,
					rootNode: columnBoard,
					boardConfiguration: { isLocked: false },
				});

				return { user, boardNodeAuthorizable };
			};

			it('should return "true"', () => {
				const { user, boardNodeAuthorizable } = setup();

				const res = boardNodeRule.hasPermission(user, boardNodeAuthorizable, {
					action: Action.read,
					requiredPermissions: [Permission.BOARD_VIEW],
				});

				expect(res).toBe(true);
			});
		});

		describe('when user does not have permission', () => {
			const setup = () => {
				const permissionA = 'a' as Permission;
				const user = userFactory.buildWithId();
				const anyBoardNode = fileElementFactory.build();
				const columnBoard = columnBoardFactory.build();
				const boardNodeAuthorizable = boardNodeAuthorizableFactory.build({
					users: [{ userId: user.id, roles: [BoardRoles.READER] }],
					id: new ObjectId().toHexString(),
					boardNode: anyBoardNode,
					rootNode: columnBoard,
					boardConfiguration: { isLocked: false },
				});

				return { user, permissionA, boardNodeAuthorizable };
			};

			it('should return "false"', () => {
				const { user, permissionA, boardNodeAuthorizable } = setup();

				const res = boardNodeRule.hasPermission(user, boardNodeAuthorizable, {
					action: Action.write,
					requiredPermissions: [permissionA],
				});

				expect(res).toBe(false);
			});
		});

		describe('when user is not part of the BoardDoAuthorizable', () => {
			const setup = () => {
				const role = roleFactory.build();
				const user = userFactory.buildWithId({ roles: [role] });
				const userWithoutPermision = userFactory.buildWithId({ roles: [role] });
				const anyBoardNode = fileElementFactory.build();
				const columnBoard = columnBoardFactory.build();
				const boardNodeAuthorizable = boardNodeAuthorizableFactory.build({
					users: [{ userId: user.id, roles: [BoardRoles.EDITOR] }],
					id: new ObjectId().toHexString(),
					boardNode: anyBoardNode,
					rootNode: columnBoard,
					boardConfiguration: { isLocked: false },
				});

				return { userWithoutPermision, boardNodeAuthorizable };
			};

			it('should return "false"', () => {
				const { userWithoutPermision, boardNodeAuthorizable } = setup();

				const res = boardNodeRule.hasPermission(userWithoutPermision, boardNodeAuthorizable, {
					action: Action.read,
					requiredPermissions: [],
				});

				expect(res).toBe(false);
			});
		});

		describe('when user does not have the desired role', () => {
			const setup = () => {
				const user = userFactory.buildWithId();
				const anyBoardNode = fileElementFactory.build();
				const columnBoard = columnBoardFactory.build();
				const boardNodeAuthorizable = boardNodeAuthorizableFactory.build({
					users: [{ userId: user.id, roles: [] }],
					id: new ObjectId().toHexString(),
					boardNode: anyBoardNode,
					rootNode: columnBoard,
					boardConfiguration: { isLocked: false },
				});

				return { user, boardNodeAuthorizable };
			};

			it('should return "false"', () => {
				const { user, boardNodeAuthorizable } = setup();

				const res = boardNodeRule.hasPermission(user, boardNodeAuthorizable, {
					action: Action.read,
					requiredPermissions: [],
				});

				expect(res).toBe(false);
			});
		});

		describe('when boardDoAuthorizable.rootDo is not visible', () => {
			describe('when user is Editor', () => {
				const setup = () => {
					const user = userFactory.buildWithId();
					const anyBoardNode = fileElementFactory.build();
					const columnBoard = columnBoardFactory.build({ isVisible: false });
					const boardNodeAuthorizable = boardNodeAuthorizableFactory.build({
						users: [{ userId: user.id, roles: [BoardRoles.EDITOR] }],
						id: new ObjectId().toHexString(),
						boardNode: anyBoardNode,
						rootNode: columnBoard,
						boardConfiguration: { isLocked: false },
					});

					return { user, boardNodeAuthorizable };
				};

				it('it should return true if trying to "write" ', () => {
					const { user, boardNodeAuthorizable } = setup();

					const res = boardNodeRule.hasPermission(user, boardNodeAuthorizable, {
						action: Action.write,
						requiredPermissions: [],
					});

					expect(res).toBe(true);
				});

				it('it should return true if trying to "read" ', () => {
					const { user, boardNodeAuthorizable } = setup();

					const res = boardNodeRule.hasPermission(user, boardNodeAuthorizable, {
						action: Action.read,
						requiredPermissions: [],
					});

					expect(res).toBe(true);
				});
			});

			describe('when user is Reader', () => {
				const setup = () => {
					const user = userFactory.buildWithId();
					const anyBoardNode = fileElementFactory.build();
					const columnBoard = columnBoardFactory.build({ isVisible: false });
					const boardNodeAuthorizable = boardNodeAuthorizableFactory.build({
						users: [{ userId: user.id, roles: [BoardRoles.READER] }],
						id: new ObjectId().toHexString(),
						boardNode: anyBoardNode,
						rootNode: columnBoard,
						boardConfiguration: { isLocked: false },
					});

					return { user, boardNodeAuthorizable };
				};

				it('it should return false if trying to "write" ', () => {
					const { user, boardNodeAuthorizable } = setup();

					const res = boardNodeRule.hasPermission(user, boardNodeAuthorizable, {
						action: Action.write,
						requiredPermissions: [],
					});

					expect(res).toBe(false);
				});

				it('it should return false if trying to "read" ', () => {
					const { user, boardNodeAuthorizable } = setup();

					const res = boardNodeRule.hasPermission(user, boardNodeAuthorizable, {
						action: Action.write,
						requiredPermissions: [],
					});

					expect(res).toBe(false);
				});
			});
		});

		describe('when boardDoAuthorizable.boardDo is a drawingElement', () => {
			describe('when required permissions do not include FILESTORAGE_CREATE or FILESTORAGE_VIEW or FILESTORAGE_REMOVE', () => {
				describe('when user is Editor', () => {
					const setup = () => {
						const user = userFactory.buildWithId();
						const drawingElement = drawingElementFactory.build();
						const columnBoard = columnBoardFactory.build();
						const boardNodeAuthorizable = boardNodeAuthorizableFactory.build({
							users: [{ userId: user.id, roles: [BoardRoles.EDITOR] }],
							id: new ObjectId().toHexString(),
							boardNode: drawingElement,
							rootNode: columnBoard,
							boardConfiguration: { isLocked: false },
						});

						return { user, boardNodeAuthorizable };
					};

					it('should return true if trying to "read"', () => {
						const { user, boardNodeAuthorizable } = setup();

						const res = boardNodeRule.hasPermission(user, boardNodeAuthorizable, {
							action: Action.read,
							requiredPermissions: [],
						});

						expect(res).toBe(true);
					});

					it('should return true if trying to "write" ', () => {
						const { user, boardNodeAuthorizable } = setup();

						const res = boardNodeRule.hasPermission(user, boardNodeAuthorizable, {
							action: Action.write,
							requiredPermissions: [],
						});

						expect(res).toBe(true);
					});
				});

				describe('when user is Reader', () => {
					const setup = () => {
						const user = userFactory.buildWithId();
						const drawingElement = drawingElementFactory.build();
						const columnBoard = columnBoardFactory.build();
						const boardNodeAuthorizable = boardNodeAuthorizableFactory.build({
							users: [{ userId: user.id, roles: [BoardRoles.READER] }],
							id: new ObjectId().toHexString(),
							boardNode: drawingElement,
							rootNode: columnBoard,
							boardConfiguration: { isLocked: false },
						});

						return { user, boardNodeAuthorizable };
					};

					it('should return true if trying to "read"', () => {
						const { user, boardNodeAuthorizable } = setup();

						const res = boardNodeRule.hasPermission(user, boardNodeAuthorizable, {
							action: Action.read,
							requiredPermissions: [],
						});

						expect(res).toBe(true);
					});

					it('should return false if trying to "write" ', () => {
						const { user, boardNodeAuthorizable } = setup();

						const res = boardNodeRule.hasPermission(user, boardNodeAuthorizable, {
							action: Action.write,
							requiredPermissions: [],
						});

						expect(res).toBe(false);
					});
				});
			});

			describe('when required permissions include FILESTORAGE_CREATE or FILESTORAGE_VIEW', () => {
				describe('when user is Editor', () => {
					const setup = () => {
						const user = userFactory.asTeacher().buildWithId();
						const drawingElement = drawingElementFactory.build();
						const columnBoard = columnBoardFactory.build();
						const boardNodeAuthorizable = boardNodeAuthorizableFactory.build({
							users: [{ userId: user.id, roles: [BoardRoles.EDITOR] }],
							id: new ObjectId().toHexString(),
							boardNode: drawingElement,
							rootNode: columnBoard,
							boardConfiguration: { isLocked: false },
						});
						userService.resolvePermissions.mockReturnValueOnce([...userPermissions, ...studentPermissions]);

						return { user, boardNodeAuthorizable };
					};

					it('should return true if trying to "read"', () => {
						const { user, boardNodeAuthorizable } = setup();

						const res = boardNodeRule.hasPermission(user, boardNodeAuthorizable, {
							action: Action.read,
							requiredPermissions: [Permission.FILESTORAGE_VIEW],
						});

						expect(res).toBe(true);
					});

					it('should return true if trying to "write" ', () => {
						const { user, boardNodeAuthorizable } = setup();

						const res = boardNodeRule.hasPermission(user, boardNodeAuthorizable, {
							action: Action.write,
							requiredPermissions: [Permission.FILESTORAGE_CREATE],
						});

						expect(res).toBe(true);
					});

					it('should return true if trying to "write" ', () => {
						const { user, boardNodeAuthorizable } = setup();

						const res = boardNodeRule.hasPermission(user, boardNodeAuthorizable, {
							action: Action.write,
							requiredPermissions: [Permission.FILESTORAGE_REMOVE],
						});

						expect(res).toBe(true);
					});
				});

				describe('when user is Reader', () => {
					const setup = () => {
						const user = userFactory.asStudent().buildWithId();
						const drawingElement = drawingElementFactory.build();
						const columnBoard = columnBoardFactory.build();
						const boardNodeAuthorizable = boardNodeAuthorizableFactory.build({
							users: [{ userId: user.id, roles: [BoardRoles.READER] }],
							id: new ObjectId().toHexString(),
							boardNode: drawingElement,
							rootNode: columnBoard,
							boardConfiguration: { isLocked: false },
						});
						userService.resolvePermissions.mockReturnValueOnce([...userPermissions, ...studentPermissions]);

						return { user, boardNodeAuthorizable };
					};
					it('should return true if trying to "read"', () => {
						const { user, boardNodeAuthorizable } = setup();

						const res = boardNodeRule.hasPermission(user, boardNodeAuthorizable, {
							action: Action.read,
							requiredPermissions: [Permission.FILESTORAGE_VIEW],
						});

						expect(res).toBe(true);
					});
					it('should ALSO return true if trying to "write" ', () => {
						const { user, boardNodeAuthorizable } = setup();

						const res = boardNodeRule.hasPermission(user, boardNodeAuthorizable, {
							action: Action.write,
							requiredPermissions: [Permission.FILESTORAGE_CREATE],
						});

						expect(res).toBe(true);
					});
				});
			});
		});

		describe('when boardDoAuthorizable.boardDo is a videoConferenceElement', () => {
			describe('when user is Admin', () => {
				const setup = (boardSettings: BoardConfiguration) => {
					const user = userFactory.asTeacher().buildWithId();
					const videoConferenceElement = videoConferenceElementFactory.build();
					const columnBoard = columnBoardFactory.build();
					const boardNodeAuthorizable = boardNodeAuthorizableFactory.build({
						users: [{ userId: user.id, roles: [BoardRoles.EDITOR, BoardRoles.ADMIN] }],
						id: new ObjectId().toHexString(),
						boardNode: videoConferenceElement,
						rootNode: columnBoard,
						boardConfiguration: boardSettings,
					});

					return { user, boardNodeAuthorizable };
				};

				describe('when board settings allow editors to create video conferences', () => {
					it('should return true if trying to "read"', () => {
						const { user, boardNodeAuthorizable } = setup({
							canEditorsManageVideoconference: true,
							isLocked: false,
						});

						const res = boardNodeRule.hasPermission(user, boardNodeAuthorizable, {
							action: Action.read,
							requiredPermissions: [],
						});

						expect(res).toBe(true);
					});
					it('should return true if trying to "write" ', () => {
						const { user, boardNodeAuthorizable } = setup({
							canEditorsManageVideoconference: true,
							isLocked: false,
						});

						const res = boardNodeRule.hasPermission(user, boardNodeAuthorizable, {
							action: Action.write,
							requiredPermissions: [],
						});

						expect(res).toBe(true);
					});
				});

				describe('when board settings prohibit editors to create video conferences', () => {
					it('should return true if trying to "read"', () => {
						const { user, boardNodeAuthorizable } = setup({
							canEditorsManageVideoconference: false,
							isLocked: false,
						});

						const res = boardNodeRule.hasPermission(user, boardNodeAuthorizable, {
							action: Action.read,
							requiredPermissions: [],
						});

						expect(res).toBe(true);
					});
					it('should return true if trying to "write" ', () => {
						const { user, boardNodeAuthorizable } = setup({
							canEditorsManageVideoconference: false,
							isLocked: false,
						});

						const res = boardNodeRule.hasPermission(user, boardNodeAuthorizable, {
							action: Action.write,
							requiredPermissions: [],
						});

						expect(res).toBe(true);
					});
				});
			});

			describe('when user is Editor', () => {
				const setup = (boardSettings: BoardConfiguration) => {
					const user = userFactory.asTeacher().buildWithId();
					const videoConferenceElement = videoConferenceElementFactory.build();
					const columnBoard = columnBoardFactory.build();
					const boardNodeAuthorizable = boardNodeAuthorizableFactory.build({
						users: [{ userId: user.id, roles: [BoardRoles.EDITOR] }],
						id: new ObjectId().toHexString(),
						boardNode: videoConferenceElement,
						rootNode: columnBoard,
						boardConfiguration: boardSettings,
					});

					return { user, boardNodeAuthorizable };
				};

				describe('when board settings allow editors to create video conferences', () => {
					it('should return true if trying to "read"', () => {
						const { user, boardNodeAuthorizable } = setup({
							canEditorsManageVideoconference: true,
							isLocked: false,
						});

						const res = boardNodeRule.hasPermission(user, boardNodeAuthorizable, {
							action: Action.read,
							requiredPermissions: [],
						});

						expect(res).toBe(true);
					});

					it('should return true if trying to "write" ', () => {
						const { user, boardNodeAuthorizable } = setup({
							canEditorsManageVideoconference: true,
							isLocked: false,
						});

						const res = boardNodeRule.hasPermission(user, boardNodeAuthorizable, {
							action: Action.write,
							requiredPermissions: [],
						});

						expect(res).toBe(true);
					});
				});

				describe('when board settings prohibit editors to create video conferences', () => {
					it('should return true if trying to "read"', () => {
						const { user, boardNodeAuthorizable } = setup({
							canEditorsManageVideoconference: false,
							isLocked: false,
						});

						const res = boardNodeRule.hasPermission(user, boardNodeAuthorizable, {
							action: Action.read,
							requiredPermissions: [],
						});

						expect(res).toBe(true);
					});

					it('should return false if trying to "write" ', () => {
						const { user, boardNodeAuthorizable } = setup({
							canEditorsManageVideoconference: false,
							isLocked: false,
						});

						const res = boardNodeRule.hasPermission(user, boardNodeAuthorizable, {
							action: Action.write,
							requiredPermissions: [],
						});

						expect(res).toBe(false);
					});
				});
			});

			describe('when user is Reader', () => {
				const setup = (boardSettings: BoardConfiguration) => {
					const user = userFactory.asTeacher().buildWithId();
					const videoConferenceElement = videoConferenceElementFactory.build();
					const columnBoard = columnBoardFactory.build();
					const boardNodeAuthorizable = boardNodeAuthorizableFactory.build({
						users: [{ userId: user.id, roles: [BoardRoles.READER] }],
						id: new ObjectId().toHexString(),
						boardNode: videoConferenceElement,
						rootNode: columnBoard,
						boardConfiguration: boardSettings,
					});

					return { user, boardNodeAuthorizable };
				};

				describe('when board settings allow editors to create video conferences', () => {
					it('should return true if trying to "read"', () => {
						const { user, boardNodeAuthorizable } = setup({
							canEditorsManageVideoconference: true,
							isLocked: false,
						});

						const res = boardNodeRule.hasPermission(user, boardNodeAuthorizable, {
							action: Action.read,
							requiredPermissions: [],
						});

						expect(res).toBe(true);
					});

					it('should return false if trying to "write" ', () => {
						const { user, boardNodeAuthorizable } = setup({
							canEditorsManageVideoconference: true,
							isLocked: false,
						});

						const res = boardNodeRule.hasPermission(user, boardNodeAuthorizable, {
							action: Action.write,
							requiredPermissions: [],
						});

						expect(res).toBe(false);
					});
				});

				describe('when board settings prohibit editors to create video conferences', () => {
					it('should return true if trying to "read"', () => {
						const { user, boardNodeAuthorizable } = setup({
							canEditorsManageVideoconference: false,
							isLocked: false,
						});

						const res = boardNodeRule.hasPermission(user, boardNodeAuthorizable, {
							action: Action.read,
							requiredPermissions: [],
						});

						expect(res).toBe(true);
					});

					it('should return false if trying to "write" ', () => {
						const { user, boardNodeAuthorizable } = setup({
							canEditorsManageVideoconference: false,
							isLocked: false,
						});

						const res = boardNodeRule.hasPermission(user, boardNodeAuthorizable, {
							action: Action.write,
							requiredPermissions: [],
						});

						expect(res).toBe(false);
					});
				});
			});
		});

		describe('when boardDoAuthorizable.boardDo is an assignmentSubmission', () => {
			describe('when required permissions do not include FILESTORAGE_CREATE or FILESTORAGE_VIEW or FILESTORAGE_REMOVE', () => {
				it('should fall through to the normal read/write handling', () => {
					const owner = userFactory.buildWithId();
					const submission = assignmentSubmissionFactory.build({ userId: owner.id });
					const columnBoard = columnBoardFactory.build();
					const boardNodeAuthorizable = boardNodeAuthorizableFactory.build({
						users: [{ userId: owner.id, roles: [BoardRoles.READER] }],
						boardNode: submission,
						rootNode: columnBoard,
						boardConfiguration: { isLocked: false },
					});

					const res = boardNodeRule.hasPermission(owner, boardNodeAuthorizable, {
						action: Action.read,
						requiredPermissions: [],
					});

					expect(res).toBe(true);
				});
			});

			describe('when required permissions include FILESTORAGE_VIEW (reading the file)', () => {
				it('should allow the owning student to read', () => {
					const owner = userFactory.asStudent().buildWithId();
					const submission = assignmentSubmissionFactory.build({ userId: owner.id });
					const element = assignmentElementFactory.build({ children: [submission] });
					const columnBoard = columnBoardFactory.build();
					const boardNodeAuthorizable = boardNodeAuthorizableFactory.build({
						users: [{ userId: owner.id, roles: [BoardRoles.READER] }],
						boardNode: submission,
						parentNode: element,
						rootNode: columnBoard,
						boardConfiguration: { isLocked: false },
					});

					userService.resolvePermissions.mockReturnValueOnce([...userPermissions, ...studentPermissions]);

					const res = boardNodeRule.hasPermission(owner, boardNodeAuthorizable, {
						action: Action.read,
						requiredPermissions: [Permission.FILESTORAGE_VIEW],
					});

					expect(res).toBe(true);
				});

				it('should allow the teacher (board editor) to read any submission', () => {
					const owner = userFactory.asStudent().buildWithId();
					const teacher = userFactory.asTeacher().buildWithId();
					const submission = assignmentSubmissionFactory.build({ userId: owner.id });
					const element = assignmentElementFactory.build({ children: [submission] });
					const columnBoard = columnBoardFactory.build();
					const boardNodeAuthorizable = boardNodeAuthorizableFactory.build({
						users: [
							{ userId: owner.id, roles: [BoardRoles.READER] },
							{ userId: teacher.id, roles: [BoardRoles.EDITOR] },
						],
						boardNode: submission,
						parentNode: element,
						rootNode: columnBoard,
						boardConfiguration: { isLocked: false },
					});

					userService.resolvePermissions.mockReturnValueOnce([...userPermissions, ...studentPermissions]);

					const res = boardNodeRule.hasPermission(teacher, boardNodeAuthorizable, {
						action: Action.read,
						requiredPermissions: [Permission.FILESTORAGE_VIEW],
					});

					expect(res).toBe(true);
				});

				it('should NOT allow a different student to read someone else’s submission file', () => {
					const owner = userFactory.asStudent().buildWithId();
					const otherStudent = userFactory.asStudent().buildWithId();
					const submission = assignmentSubmissionFactory.build({ userId: owner.id });
					const element = assignmentElementFactory.build({ children: [submission] });
					const columnBoard = columnBoardFactory.build();
					const boardNodeAuthorizable = boardNodeAuthorizableFactory.build({
						users: [
							{ userId: owner.id, roles: [BoardRoles.READER] },
							{ userId: otherStudent.id, roles: [BoardRoles.READER] },
						],
						boardNode: submission,
						parentNode: element,
						rootNode: columnBoard,
						boardConfiguration: { isLocked: false },
					});

					userService.resolvePermissions.mockReturnValueOnce([...userPermissions, ...studentPermissions]);

					const res = boardNodeRule.hasPermission(otherStudent, boardNodeAuthorizable, {
						action: Action.read,
						requiredPermissions: [Permission.FILESTORAGE_VIEW],
					});

					expect(res).toBe(false);
				});
			});

			describe('when required permissions include FILESTORAGE_CREATE (uploading the file)', () => {
				it('should allow the owning student to upload while the assignment is still submittable', () => {
					const owner = userFactory.asStudent().buildWithId();
					const submission = assignmentSubmissionFactory.build({ userId: owner.id, returnedAt: undefined });
					const element = assignmentElementFactory.build({ children: [submission], dueDate: undefined });
					const columnBoard = columnBoardFactory.build();
					const boardNodeAuthorizable = boardNodeAuthorizableFactory.build({
						users: [{ userId: owner.id, roles: [BoardRoles.READER] }],
						boardNode: submission,
						parentNode: element,
						rootNode: columnBoard,
						boardConfiguration: { isLocked: false },
					});

					userService.resolvePermissions.mockReturnValueOnce([...userPermissions, ...studentPermissions]);

					const res = boardNodeRule.hasPermission(owner, boardNodeAuthorizable, {
						action: Action.write,
						requiredPermissions: [Permission.FILESTORAGE_CREATE],
					});

					expect(res).toBe(true);
				});

				it('should NOT allow the teacher (board editor) to upload into a student’s submission', () => {
					const owner = userFactory.asStudent().buildWithId();
					const teacher = userFactory.asTeacher().buildWithId();
					const submission = assignmentSubmissionFactory.build({ userId: owner.id, returnedAt: undefined });
					const element = assignmentElementFactory.build({ children: [submission], dueDate: undefined });
					const columnBoard = columnBoardFactory.build();
					const boardNodeAuthorizable = boardNodeAuthorizableFactory.build({
						users: [
							{ userId: owner.id, roles: [BoardRoles.READER] },
							{ userId: teacher.id, roles: [BoardRoles.EDITOR] },
						],
						boardNode: submission,
						parentNode: element,
						rootNode: columnBoard,
						boardConfiguration: { isLocked: false },
					});

					userService.resolvePermissions.mockReturnValueOnce([...userPermissions, ...studentPermissions]);

					const res = boardNodeRule.hasPermission(teacher, boardNodeAuthorizable, {
						action: Action.write,
						requiredPermissions: [Permission.FILESTORAGE_CREATE],
					});

					expect(res).toBe(false);
				});

				it('should NOT allow the owning student to upload once the submission has been returned', () => {
					const owner = userFactory.asStudent().buildWithId();
					const submission = assignmentSubmissionFactory.build({ userId: owner.id, returnedAt: new Date() });
					const element = assignmentElementFactory.build({ children: [submission], dueDate: undefined });
					const columnBoard = columnBoardFactory.build();
					const boardNodeAuthorizable = boardNodeAuthorizableFactory.build({
						users: [{ userId: owner.id, roles: [BoardRoles.READER] }],
						boardNode: submission,
						parentNode: element,
						rootNode: columnBoard,
						boardConfiguration: { isLocked: false },
					});

					userService.resolvePermissions.mockReturnValueOnce([...userPermissions, ...studentPermissions]);

					const res = boardNodeRule.hasPermission(owner, boardNodeAuthorizable, {
						action: Action.write,
						requiredPermissions: [Permission.FILESTORAGE_CREATE],
					});

					expect(res).toBe(false);
				});

				it('should NOT allow the owning student to upload after the grace period has ended', () => {
					const owner = userFactory.asStudent().buildWithId();
					const submission = assignmentSubmissionFactory.build({ userId: owner.id, returnedAt: undefined });
					const element = assignmentElementFactory.build({
						children: [submission],
						dueDate: new Date('2020-01-01T00:00:00.000Z'),
						graceMinutes: 0,
					});
					const columnBoard = columnBoardFactory.build();
					const boardNodeAuthorizable = boardNodeAuthorizableFactory.build({
						users: [{ userId: owner.id, roles: [BoardRoles.READER] }],
						boardNode: submission,
						parentNode: element,
						rootNode: columnBoard,
						boardConfiguration: { isLocked: false },
					});

					userService.resolvePermissions.mockReturnValueOnce([...userPermissions, ...studentPermissions]);

					const res = boardNodeRule.hasPermission(owner, boardNodeAuthorizable, {
						action: Action.write,
						requiredPermissions: [Permission.FILESTORAGE_CREATE],
					});

					expect(res).toBe(false);
				});
			});
		});

		describe('when the write action targets an assignmentElement and readersCanEdit is enabled', () => {
			// This must stay false even though `readersCanEdit` normally lets a board reader
			// edit any element's content - dueDate/maxPoints/grading carry real consequences
			// for a student, unlike e.g. a rich text element's content. See board-node.rule.ts,
			// the carve-out inside _canEditBoard, and the board-title precedent right next to it.
			it('should NOT allow a board reader to edit the assignment element, even with readersCanEdit on', () => {
				const student = userFactory.asStudent().buildWithId();
				const element = assignmentElementFactory.build();
				const columnBoard = columnBoardFactory.build();
				const boardNodeAuthorizable = boardNodeAuthorizableFactory.build({
					users: [{ userId: student.id, roles: [BoardRoles.READER] }],
					boardNode: element,
					rootNode: columnBoard,
					boardConfiguration: { canReadersEdit: true, isLocked: false },
				});

				const res = boardNodeRule.hasPermission(student, boardNodeAuthorizable, {
					action: Action.write,
					requiredPermissions: [],
				});

				expect(res).toBe(false);
			});

			it('should still allow a real board editor to edit the assignment element', () => {
				const teacher = userFactory.asTeacher().buildWithId();
				const element = assignmentElementFactory.build();
				const columnBoard = columnBoardFactory.build();
				const boardNodeAuthorizable = boardNodeAuthorizableFactory.build({
					users: [{ userId: teacher.id, roles: [BoardRoles.EDITOR] }],
					boardNode: element,
					rootNode: columnBoard,
					boardConfiguration: { canReadersEdit: true, isLocked: false },
				});

				const res = boardNodeRule.hasPermission(teacher, boardNodeAuthorizable, {
					action: Action.write,
					requiredPermissions: [],
				});

				expect(res).toBe(true);
			});
		});
	});

	describe('can (assignment operations)', () => {
		it('createOwnAssignmentSubmission: should allow a plain board reader', () => {
			const student = userFactory.asStudent().buildWithId();
			const element = assignmentElementFactory.build();
			const boardNodeAuthorizable = boardNodeAuthorizableFactory.build({
				users: [{ userId: student.id, roles: [BoardRoles.READER] }],
				boardNode: element,
			});

			expect(boardNodeRule.can('createOwnAssignmentSubmission', student, boardNodeAuthorizable)).toBe(true);
		});

		it('createOwnAssignmentSubmission: should NOT allow a board editor', () => {
			const teacher = userFactory.asTeacher().buildWithId();
			const element = assignmentElementFactory.build();
			const boardNodeAuthorizable = boardNodeAuthorizableFactory.build({
				users: [{ userId: teacher.id, roles: [BoardRoles.EDITOR] }],
				boardNode: element,
			});

			expect(boardNodeRule.can('createOwnAssignmentSubmission', teacher, boardNodeAuthorizable)).toBe(false);
		});

		it('updateOwnAssignmentSubmission: should allow the owner', () => {
			const owner = userFactory.buildWithId();
			const submission = assignmentSubmissionFactory.build({ userId: owner.id });
			const boardNodeAuthorizable = boardNodeAuthorizableFactory.build({
				users: [{ userId: owner.id, roles: [BoardRoles.READER] }],
				boardNode: submission,
			});

			expect(boardNodeRule.can('updateOwnAssignmentSubmission', owner, boardNodeAuthorizable)).toBe(true);
		});

		it('updateOwnAssignmentSubmission: should NOT allow a different student', () => {
			const owner = userFactory.buildWithId();
			const otherStudent = userFactory.asStudent().buildWithId();
			const submission = assignmentSubmissionFactory.build({ userId: owner.id });
			const boardNodeAuthorizable = boardNodeAuthorizableFactory.build({
				users: [
					{ userId: owner.id, roles: [BoardRoles.READER] },
					{ userId: otherStudent.id, roles: [BoardRoles.READER] },
				],
				boardNode: submission,
			});

			expect(boardNodeRule.can('updateOwnAssignmentSubmission', otherStudent, boardNodeAuthorizable)).toBe(false);
		});

		it('gradeAssignmentSubmission: should allow a board editor', () => {
			const teacher = userFactory.asTeacher().buildWithId();
			const submission = assignmentSubmissionFactory.build();
			const boardNodeAuthorizable = boardNodeAuthorizableFactory.build({
				users: [{ userId: teacher.id, roles: [BoardRoles.EDITOR] }],
				boardNode: submission,
			});

			expect(boardNodeRule.can('gradeAssignmentSubmission', teacher, boardNodeAuthorizable)).toBe(true);
		});

		it('gradeAssignmentSubmission: should NOT allow the submission’s own owner (a plain reader)', () => {
			const owner = userFactory.asStudent().buildWithId();
			const submission = assignmentSubmissionFactory.build({ userId: owner.id });
			const boardNodeAuthorizable = boardNodeAuthorizableFactory.build({
				users: [{ userId: owner.id, roles: [BoardRoles.READER] }],
				boardNode: submission,
			});

			expect(boardNodeRule.can('gradeAssignmentSubmission', owner, boardNodeAuthorizable)).toBe(false);
		});
	});

	describe('listAllowedOperations', () => {
		describe('when user is Administrator and BoardAdmin', () => {
			const setup = (boardSettings: BoardConfiguration) => {
				const user = userFactory.asAdmin().buildWithId();
				const videoConferenceElement = videoConferenceElementFactory.build();
				const columnBoard = columnBoardFactory.build();
				const boardNodeAuthorizable = boardNodeAuthorizableFactory.build({
					users: [{ userId: user.id, roles: [BoardRoles.EDITOR, BoardRoles.ADMIN] }],
					id: new ObjectId().toHexString(),
					boardNode: videoConferenceElement,
					rootNode: columnBoard,
					boardConfiguration: boardSettings,
				});

				return { user, boardNodeAuthorizable };
			};

			it('should return the expected allowed operations', () => {
				const { user, boardNodeAuthorizable } = setup({ canEditorsManageVideoconference: true, isLocked: false });

				const res = boardNodeRule.listAllowedOperations(user, boardNodeAuthorizable);
				const expectedAllowedOperations = {
					// board
					copyBoard: true,
					deleteBoard: true,
					findBoard: true,
					relocateContent: true,
					shareBoard: true,
					updateBoardLayout: true,
					updateBoardTitle: true,
					updateReadersCanEditSetting: false,

					// column
					copyColumn: true,
					createColumn: true,
					deleteColumn: true,
					moveColumn: true,
					shareColumn: true,
					updateColumnTitle: true,

					// card
					copyCard: true,
					createCard: true,
					deleteCard: true,
					findCards: true,
					moveCard: true,
					shareCard: true,
					updateCardHeight: true,
					updateCardTitle: true,
					updateCardColor: true,

					// element
					createElement: true,
					deleteElement: true,
					moveElement: true,
					updateElement: true,
					viewElement: true,

					// element / externalToolElement
					createExternalToolElement: false,

					// element / fileElement
					createFileElement: true,

					// element / videoConferenceElement
					manageVideoConference: true,

					// element / assignmentElement
					viewAssignmentSubmissions: true,
					createOwnAssignmentSubmission: false,
					updateOwnAssignmentSubmission: false,
					deleteOwnAssignmentSubmission: false,
					gradeAssignmentSubmission: true,

					// mediaBoard
					collapseMediaBoard: true,
					updateBoardVisibility: true,
					updateMediaBoardColor: true,
					updateMediaBoardLayout: true,
					viewMediaBoard: true,

					// mediaBoardLine
					collapseMediaBoardLine: true,
					createMediaBoardLine: true,
					deleteMediaBoardLine: true,
					updateMediaBoardLine: true,
					updateMediaBoardLineColor: true,
				} satisfies Record<BoardOperation, boolean>;

				expect(res).toEqual(expectedAllowedOperations);
			});
		});

		describe('when user is Teacher and BoardEditor', () => {
			const setup = (boardSettings: BoardConfiguration) => {
				const user = userFactory.asTeacher().buildWithId();
				const videoConferenceElement = videoConferenceElementFactory.build();
				const columnBoard = columnBoardFactory.build();
				const boardNodeAuthorizable = boardNodeAuthorizableFactory.build({
					users: [{ userId: user.id, roles: [BoardRoles.EDITOR] }],
					id: new ObjectId().toHexString(),
					boardNode: videoConferenceElement,
					rootNode: columnBoard,
					boardConfiguration: boardSettings,
				});

				return { user, boardNodeAuthorizable };
			};

			it('should return the expected allowed operations', () => {
				const { user, boardNodeAuthorizable } = setup({ canEditorsManageVideoconference: true, isLocked: false });

				const res = boardNodeRule.listAllowedOperations(user, boardNodeAuthorizable);
				const expectedAllowedOperations = {
					// board
					copyBoard: true,
					deleteBoard: true,
					findBoard: true,
					relocateContent: false,
					shareBoard: false,
					updateBoardLayout: true,
					updateBoardTitle: true,
					updateReadersCanEditSetting: false,

					// column
					copyColumn: true,
					createColumn: true,
					deleteColumn: true,
					moveColumn: true,
					shareColumn: false,
					updateColumnTitle: true,

					// card
					copyCard: true,
					createCard: true,
					deleteCard: true,
					findCards: true,
					moveCard: true,
					shareCard: false,
					updateCardHeight: true,
					updateCardTitle: true,
					updateCardColor: true,

					// element
					createElement: true,
					deleteElement: true,
					moveElement: true,
					updateElement: true,
					viewElement: true,

					// element / externalToolElement
					createExternalToolElement: true,

					// element / fileElement
					createFileElement: true,

					// element / videoConferenceElement
					manageVideoConference: true,

					// element / assignmentElement
					viewAssignmentSubmissions: true,
					createOwnAssignmentSubmission: false,
					updateOwnAssignmentSubmission: false,
					deleteOwnAssignmentSubmission: false,
					gradeAssignmentSubmission: true,

					// mediaBoard
					collapseMediaBoard: true,
					updateBoardVisibility: true,
					updateMediaBoardColor: true,
					updateMediaBoardLayout: true,
					viewMediaBoard: true,

					// mediaBoardLine
					collapseMediaBoardLine: true,
					createMediaBoardLine: true,
					deleteMediaBoardLine: true,
					updateMediaBoardLine: true,
					updateMediaBoardLineColor: true,
				} satisfies Record<BoardOperation, boolean>;

				expect(res).toEqual(expectedAllowedOperations);
			});
		});

		describe('when user is Student and BoardReader', () => {
			const setup = (boardSettings: BoardConfiguration) => {
				const user = userFactory.asStudent().buildWithId();
				const videoConferenceElement = videoConferenceElementFactory.build();
				const columnBoard = columnBoardFactory.build();
				const boardNodeAuthorizable = boardNodeAuthorizableFactory.build({
					users: [{ userId: user.id, roles: [BoardRoles.READER] }],
					id: new ObjectId().toHexString(),
					boardNode: videoConferenceElement,
					rootNode: columnBoard,
					boardConfiguration: boardSettings,
				});

				return { user, boardNodeAuthorizable };
			};

			it('should return the expected allowed operations', () => {
				const { user, boardNodeAuthorizable } = setup({ canEditorsManageVideoconference: true, isLocked: false });

				const res = boardNodeRule.listAllowedOperations(user, boardNodeAuthorizable);

				const expectedAllowedOperations = {
					// board
					copyBoard: false,
					deleteBoard: false,
					findBoard: true,
					relocateContent: false,
					shareBoard: false,
					updateBoardLayout: false,
					updateBoardTitle: false,
					updateReadersCanEditSetting: false,

					// column
					copyColumn: false,
					createColumn: false,
					deleteColumn: false,
					moveColumn: false,
					shareColumn: false,
					updateColumnTitle: false,

					// card
					copyCard: false,
					createCard: false,
					deleteCard: false,
					findCards: true,
					moveCard: false,
					shareCard: false,
					updateCardHeight: false,
					updateCardTitle: false,
					updateCardColor: false,

					// element
					createElement: false,
					deleteElement: false,
					moveElement: false,
					updateElement: false,
					viewElement: true,

					// element / externalToolElement
					createExternalToolElement: false,

					// element / fileElement
					createFileElement: false,

					// element / videoConferenceElement
					manageVideoConference: false,

					// element / assignmentElement
					viewAssignmentSubmissions: true,
					createOwnAssignmentSubmission: true,
					updateOwnAssignmentSubmission: false,
					deleteOwnAssignmentSubmission: false,
					gradeAssignmentSubmission: false,

					// mediaBoard
					collapseMediaBoard: false,
					updateBoardVisibility: false,
					updateMediaBoardColor: false,
					updateMediaBoardLayout: false,
					viewMediaBoard: true,

					// mediaBoardLine
					collapseMediaBoardLine: false,
					createMediaBoardLine: false,
					deleteMediaBoardLine: false,
					updateMediaBoardLine: false,
					updateMediaBoardLineColor: false,
				} satisfies Record<BoardOperation, boolean>;

				expect(res).toEqual(expectedAllowedOperations);
			});

			describe('when board has readersCanEdit enabled', () => {
				it('should not allow the board title to be edited', () => {
					const { user, boardNodeAuthorizable } = setup({
						canReadersEdit: true,
						canEditorsManageVideoconference: true,
						isLocked: false,
					});

					const res = boardNodeRule.listAllowedOperations(user, boardNodeAuthorizable);

					expect(res.updateBoardTitle).toEqual(false);
				});
			});
		});

		describe('when board is locked ', () => {
			const setup = () => {
				const user = userFactory.asTeacher().buildWithId();
				const videoConferenceElement = videoConferenceElementFactory.build();
				const columnBoard = columnBoardFactory.build();
				const boardNodeAuthorizable = boardNodeAuthorizableFactory.build({
					users: [{ userId: user.id, roles: [BoardRoles.EDITOR] }],
					id: new ObjectId().toHexString(),
					boardNode: videoConferenceElement,
					rootNode: columnBoard,
					boardConfiguration: { isLocked: true },
				});

				return { user, boardNodeAuthorizable };
			};

			it('should return all operations as false', () => {
				const { user, boardNodeAuthorizable } = setup();

				const res = boardNodeRule.listAllowedOperations(user, boardNodeAuthorizable);
				const expectedAllowedOperations = {
					// board
					copyBoard: false,
					deleteBoard: false,
					findBoard: false,
					relocateContent: false,
					shareBoard: false,
					updateBoardLayout: false,
					updateBoardTitle: false,
					updateReadersCanEditSetting: false,

					// column
					copyColumn: false,
					createColumn: false,
					deleteColumn: false,
					moveColumn: false,
					shareColumn: false,
					updateColumnTitle: false,

					// card
					copyCard: false,
					createCard: false,
					deleteCard: false,
					findCards: false,
					moveCard: false,
					shareCard: false,
					updateCardHeight: false,
					updateCardTitle: false,
					updateCardColor: false,

					// element
					createElement: false,
					deleteElement: false,
					moveElement: false,
					updateElement: false,
					viewElement: false,

					// element / externalToolElement
					createExternalToolElement: false,

					// element / fileElement
					createFileElement: false,

					// element / videoConferenceElement
					manageVideoConference: false,

					// element / assignmentElement
					viewAssignmentSubmissions: false,
					createOwnAssignmentSubmission: false,
					updateOwnAssignmentSubmission: false,
					deleteOwnAssignmentSubmission: false,
					gradeAssignmentSubmission: false,

					// mediaBoard
					collapseMediaBoard: false,
					updateBoardVisibility: false,
					updateMediaBoardColor: false,
					updateMediaBoardLayout: false,
					viewMediaBoard: false,

					// mediaBoardLine
					collapseMediaBoardLine: false,
					createMediaBoardLine: false,
					deleteMediaBoardLine: false,
					updateMediaBoardLine: false,
					updateMediaBoardLineColor: false,
				} satisfies Record<BoardOperation, boolean>;

				expect(res).toEqual(expectedAllowedOperations);
			});
		});
	});

	describe('hasPermission when board is locked', () => {
		const setup = () => {
			const user = userFactory.buildWithId();
			const anyBoardNode = fileElementFactory.build();
			const columnBoard = columnBoardFactory.build();
			const boardNodeAuthorizable = boardNodeAuthorizableFactory.build({
				users: [{ userId: user.id, roles: [BoardRoles.EDITOR] }],
				id: new ObjectId().toHexString(),
				boardNode: anyBoardNode,
				rootNode: columnBoard,
				boardConfiguration: { isLocked: true },
			});

			return { user, boardNodeAuthorizable };
		};

		it('should return false for read action', () => {
			const { user, boardNodeAuthorizable } = setup();

			const res = boardNodeRule.hasPermission(user, boardNodeAuthorizable, {
				action: Action.read,
				requiredPermissions: [],
			});

			expect(res).toBe(false);
		});

		it('should return false for write action', () => {
			const { user, boardNodeAuthorizable } = setup();

			const res = boardNodeRule.hasPermission(user, boardNodeAuthorizable, {
				action: Action.write,
				requiredPermissions: [],
			});

			expect(res).toBe(false);
		});
	});
});
