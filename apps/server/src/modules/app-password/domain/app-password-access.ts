import { RoleName } from '@modules/role';

// featuremaxxing (2026-09-28): the network drive is for teachers only for now - students
// neither get app passwords nor into the drive with one they may still hold.
export const canUseAppPasswords = (roleNames: string[]): boolean => roleNames.includes(RoleName.TEACHER);
