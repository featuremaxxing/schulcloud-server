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
import { type BoardConfiguration, PollAudience } from '../domain';
import {
	boardNodeAuthorizableFactory,
	columnBoardFactory,
	drawingElementFactory,
	fileElementFactory,
	pollElementFactory,
	pollVoteFactory,
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

					// element / pollElement
					createOwnPollVote: false,
					updateOwnPollVote: false,
					viewPollResults: true,
					managePoll: true,

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

					// element / pollElement
					createOwnPollVote: false,
					updateOwnPollVote: false,
					viewPollResults: true,
					managePoll: true,

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

					// element / pollElement
					// this fixture's boardNode is a videoConferenceElement, not a poll - a
					// board reader is not automatically an eligible voter for a node that
					// isn't a poll at all (see _canVoteInPoll)
					createOwnPollVote: false,
					updateOwnPollVote: false,
					viewPollResults: true,
					managePoll: false,

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

					// element / pollElement
					createOwnPollVote: false,
					updateOwnPollVote: false,
					viewPollResults: false,
					managePoll: false,

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

	describe('poll operations', () => {
		describe('createOwnPollVote', () => {
			it('should allow a plain student reader to create a vote', () => {
				const student = userFactory.asStudent().buildWithId();
				const pollElement = pollElementFactory.build();
				const columnBoard = columnBoardFactory.build();
				const boardNodeAuthorizable = boardNodeAuthorizableFactory.build({
					users: [{ userId: student.id, roles: [BoardRoles.READER] }],
					boardNode: pollElement,
					rootNode: columnBoard,
				});

				expect(boardNodeRule.can('createOwnPollVote', student, boardNodeAuthorizable)).toBe(true);
			});

			it('should NOT allow a board editor to create a vote via this operation', () => {
				const teacher = userFactory.asTeacher().buildWithId();
				const pollElement = pollElementFactory.build();
				const columnBoard = columnBoardFactory.build();
				const boardNodeAuthorizable = boardNodeAuthorizableFactory.build({
					users: [{ userId: teacher.id, roles: [BoardRoles.EDITOR] }],
					boardNode: pollElement,
					rootNode: columnBoard,
				});

				expect(boardNodeRule.can('createOwnPollVote', teacher, boardNodeAuthorizable)).toBe(false);
			});

			it('should allow a board editor to vote when audience is TEACHERS', () => {
				const teacher = userFactory.asTeacher().buildWithId();
				const pollElement = pollElementFactory.build({ audience: PollAudience.TEACHERS });
				const columnBoard = columnBoardFactory.build();
				const boardNodeAuthorizable = boardNodeAuthorizableFactory.build({
					users: [{ userId: teacher.id, roles: [BoardRoles.EDITOR] }],
					boardNode: pollElement,
					rootNode: columnBoard,
				});

				expect(boardNodeRule.can('createOwnPollVote', teacher, boardNodeAuthorizable)).toBe(true);
			});

			it('should NOT allow a plain student reader to vote when audience is TEACHERS', () => {
				const student = userFactory.asStudent().buildWithId();
				const pollElement = pollElementFactory.build({ audience: PollAudience.TEACHERS });
				const columnBoard = columnBoardFactory.build();
				const boardNodeAuthorizable = boardNodeAuthorizableFactory.build({
					users: [{ userId: student.id, roles: [BoardRoles.READER] }],
					boardNode: pollElement,
					rootNode: columnBoard,
				});

				expect(boardNodeRule.can('createOwnPollVote', student, boardNodeAuthorizable)).toBe(false);
			});

			it('should allow both a reader and an editor to vote when audience is ALL', () => {
				const student = userFactory.asStudent().buildWithId();
				const teacher = userFactory.asTeacher().buildWithId();
				const pollElement = pollElementFactory.build({ audience: PollAudience.ALL });
				const columnBoard = columnBoardFactory.build();
				const boardNodeAuthorizable = boardNodeAuthorizableFactory.build({
					users: [
						{ userId: student.id, roles: [BoardRoles.READER] },
						{ userId: teacher.id, roles: [BoardRoles.EDITOR] },
					],
					boardNode: pollElement,
					rootNode: columnBoard,
				});

				expect(boardNodeRule.can('createOwnPollVote', student, boardNodeAuthorizable)).toBe(true);
				expect(boardNodeRule.can('createOwnPollVote', teacher, boardNodeAuthorizable)).toBe(true);
			});

			it('should honor audienceRoles when audience is CUSTOM', () => {
				const student = userFactory.asStudent().buildWithId();
				const teacher = userFactory.asTeacher().buildWithId();
				const pollElement = pollElementFactory.build({
					audience: PollAudience.CUSTOM,
					audienceRoles: [BoardRoles.EDITOR],
				});
				const columnBoard = columnBoardFactory.build();
				const boardNodeAuthorizable = boardNodeAuthorizableFactory.build({
					users: [
						{ userId: student.id, roles: [BoardRoles.READER] },
						{ userId: teacher.id, roles: [BoardRoles.EDITOR] },
					],
					boardNode: pollElement,
					rootNode: columnBoard,
				});

				expect(boardNodeRule.can('createOwnPollVote', student, boardNodeAuthorizable)).toBe(false);
				expect(boardNodeRule.can('createOwnPollVote', teacher, boardNodeAuthorizable)).toBe(true);
			});

			it('should NOT allow voting on a node that is not a poll element', () => {
				const student = userFactory.asStudent().buildWithId();
				const columnBoard = columnBoardFactory.build();
				const boardNodeAuthorizable = boardNodeAuthorizableFactory.build({
					users: [{ userId: student.id, roles: [BoardRoles.READER] }],
					// default boardNode from the factory is a plain column, not a poll element
					rootNode: columnBoard,
				});

				expect(boardNodeRule.can('createOwnPollVote', student, boardNodeAuthorizable)).toBe(false);
			});
		});

		describe('updateOwnPollVote', () => {
			it('should allow the owning student to update their own vote', () => {
				const owner = userFactory.asStudent().buildWithId();
				const vote = pollVoteFactory.build({ userId: owner.id });
				const pollElement = pollElementFactory.build({ children: [vote] });
				const columnBoard = columnBoardFactory.build();
				const boardNodeAuthorizable = boardNodeAuthorizableFactory.build({
					users: [{ userId: owner.id, roles: [BoardRoles.READER] }],
					boardNode: vote,
					parentNode: pollElement,
					rootNode: columnBoard,
				});

				expect(boardNodeRule.can('updateOwnPollVote', owner, boardNodeAuthorizable)).toBe(true);
			});

			it('should NOT allow a different student to update someone else’s vote', () => {
				const owner = userFactory.asStudent().buildWithId();
				const otherStudent = userFactory.asStudent().buildWithId();
				const vote = pollVoteFactory.build({ userId: owner.id });
				const pollElement = pollElementFactory.build({ children: [vote] });
				const columnBoard = columnBoardFactory.build();
				const boardNodeAuthorizable = boardNodeAuthorizableFactory.build({
					users: [
						{ userId: owner.id, roles: [BoardRoles.READER] },
						{ userId: otherStudent.id, roles: [BoardRoles.READER] },
					],
					boardNode: vote,
					parentNode: pollElement,
					rootNode: columnBoard,
				});

				expect(boardNodeRule.can('updateOwnPollVote', otherStudent, boardNodeAuthorizable)).toBe(false);
			});

			it('should NOT allow updating a vote whose poll no longer has the voter in its audience', () => {
				// e.g. the poll's audience was changed from ALL to TEACHERS after the vote was
				// cast (see U-R4: the client locks this once votes exist, this is the server-side
				// belt to that suspenders)
				const owner = userFactory.asStudent().buildWithId();
				const vote = pollVoteFactory.build({ userId: owner.id });
				const pollElement = pollElementFactory.build({ children: [vote], audience: PollAudience.TEACHERS });
				const columnBoard = columnBoardFactory.build();
				const boardNodeAuthorizable = boardNodeAuthorizableFactory.build({
					users: [{ userId: owner.id, roles: [BoardRoles.READER] }],
					boardNode: vote,
					parentNode: pollElement,
					rootNode: columnBoard,
				});

				expect(boardNodeRule.can('updateOwnPollVote', owner, boardNodeAuthorizable)).toBe(false);
			});
		});

		describe('managePoll', () => {
			it('should allow a board editor to manage the poll', () => {
				const teacher = userFactory.asTeacher().buildWithId();
				const pollElement = pollElementFactory.build();
				const columnBoard = columnBoardFactory.build();
				const boardNodeAuthorizable = boardNodeAuthorizableFactory.build({
					users: [{ userId: teacher.id, roles: [BoardRoles.EDITOR] }],
					boardNode: pollElement,
					rootNode: columnBoard,
				});

				expect(boardNodeRule.can('managePoll', teacher, boardNodeAuthorizable)).toBe(true);
			});

			it('should NOT let a reader manage the poll even when readersCanEdit is on', () => {
				const student = userFactory.asStudent().buildWithId();
				const pollElement = pollElementFactory.build();
				const columnBoard = columnBoardFactory.build();
				const boardNodeAuthorizable = boardNodeAuthorizableFactory.build({
					users: [{ userId: student.id, roles: [BoardRoles.READER] }],
					boardNode: pollElement,
					rootNode: columnBoard,
					boardConfiguration: { canReadersEdit: true },
				});

				expect(boardNodeRule.can('managePoll', student, boardNodeAuthorizable)).toBe(false);
			});

			it('should NOT let a reader manage a poll vote even when readersCanEdit is on', () => {
				const student = userFactory.asStudent().buildWithId();
				const vote = pollVoteFactory.build({ userId: student.id });
				const columnBoard = columnBoardFactory.build();
				const boardNodeAuthorizable = boardNodeAuthorizableFactory.build({
					users: [{ userId: student.id, roles: [BoardRoles.READER] }],
					boardNode: vote,
					rootNode: columnBoard,
					boardConfiguration: { canReadersEdit: true },
				});

				expect(boardNodeRule.can('managePoll', student, boardNodeAuthorizable)).toBe(false);
			});
		});

		describe('viewPollResults', () => {
			it('should allow a board reader to view results', () => {
				const student = userFactory.asStudent().buildWithId();
				const pollElement = pollElementFactory.build();
				const columnBoard = columnBoardFactory.build();
				const boardNodeAuthorizable = boardNodeAuthorizableFactory.build({
					users: [{ userId: student.id, roles: [BoardRoles.READER] }],
					boardNode: pollElement,
					rootNode: columnBoard,
				});

				expect(boardNodeRule.can('viewPollResults', student, boardNodeAuthorizable)).toBe(true);
			});
		});
	});
});
