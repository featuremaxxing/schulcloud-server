import { AssignmentStatus } from '@modules/board';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export interface AssignmentListItemResponseProps {
	id: string;
	roomId: string;
	boardId: string;
	cardId: string;
	title: string;
	startDate: string | null;
	dueDate: string | null;
	lateUntil: string | null;
	isStarted: boolean;
	isSubmittable: boolean;
	maxPoints: number | null;
	submissionsSubmitted: number | null;
	submissionsTotal: number | null;
	ownSubmissionStatus: AssignmentStatus | null;
	ownSubmissionIsLate: boolean | null;
}

export class AssignmentListItemResponse {
	constructor(props: AssignmentListItemResponseProps) {
		this.id = props.id;
		this.roomId = props.roomId;
		this.boardId = props.boardId;
		this.cardId = props.cardId;
		this.title = props.title;
		this.startDate = props.startDate;
		this.dueDate = props.dueDate;
		this.lateUntil = props.lateUntil;
		this.isStarted = props.isStarted;
		this.isSubmittable = props.isSubmittable;
		this.maxPoints = props.maxPoints;
		this.submissionsSubmitted = props.submissionsSubmitted;
		this.submissionsTotal = props.submissionsTotal;
		this.ownSubmissionStatus = props.ownSubmissionStatus;
		this.ownSubmissionIsLate = props.ownSubmissionIsLate;
	}

	@ApiProperty()
	id: string;

	@ApiProperty({ description: 'room the containing board belongs to' })
	roomId: string;

	@ApiProperty({ description: 'board containing the element, for deep-linking' })
	boardId: string;

	@ApiProperty({ description: 'card containing the element, for deep-linking' })
	cardId: string;

	@ApiProperty()
	title: string;

	@ApiPropertyOptional({ type: String, nullable: true })
	startDate: string | null;

	@ApiPropertyOptional({ type: String, nullable: true })
	dueDate: string | null;

	@ApiPropertyOptional({ type: String, nullable: true, description: 'dueDate + graceMinutes, derived' })
	lateUntil: string | null;

	@ApiProperty({ description: 'whether startDate has passed (always true without startDate)' })
	isStarted: boolean;

	@ApiProperty({ description: 'whether submissions are currently accepted (start + deadline + grace period)' })
	isSubmittable: boolean;

	@ApiPropertyOptional({ type: Number, nullable: true })
	maxPoints: number | null;

	@ApiPropertyOptional({
		type: Number,
		nullable: true,
		description: 'teacher only: submissions already handed in (status other than open)',
	})
	submissionsSubmitted: number | null;

	@ApiPropertyOptional({ type: Number, nullable: true, description: 'teacher only: all submissions' })
	submissionsTotal: number | null;

	@ApiPropertyOptional({
		enum: AssignmentStatus,
		enumName: 'AssignmentStatus',
		nullable: true,
		description: 'student only',
	})
	ownSubmissionStatus: AssignmentStatus | null;

	@ApiPropertyOptional({ type: Boolean, nullable: true, description: 'student only' })
	ownSubmissionIsLate: boolean | null;
}

export class AssignmentListResponse {
	constructor(assignments: AssignmentListItemResponse[]) {
		this.assignments = assignments;
	}

	@ApiProperty({ type: [AssignmentListItemResponse] })
	assignments: AssignmentListItemResponse[];
}
