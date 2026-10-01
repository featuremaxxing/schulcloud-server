// The colors a learning path can take, so a teacher can tell a group: "you do the blue one".
export enum LearningPathColor {
	BLUE = 'blue',
	GREEN = 'green',
	ORANGE = 'orange',
	PURPLE = 'purple',
	RED = 'red',
	TEAL = 'teal',
	YELLOW = 'yellow',
	PINK = 'pink',
}

export const LEARNING_PATH_COLORS: LearningPathColor[] = Object.values(LearningPathColor);
