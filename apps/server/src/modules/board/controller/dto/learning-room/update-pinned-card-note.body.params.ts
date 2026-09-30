import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export const PINNED_CARD_NOTE_MAX_LENGTH = 2000;

export class UpdatePinnedCardNoteBodyParams {
	@IsString()
	@MaxLength(PINNED_CARD_NOTE_MAX_LENGTH)
	@ApiProperty({
		description: 'Private note on a pinned card. An empty string removes the note.',
		maxLength: PINNED_CARD_NOTE_MAX_LENGTH,
	})
	note!: string;
}
