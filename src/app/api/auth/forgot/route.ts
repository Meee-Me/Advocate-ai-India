import { open } from '@/lib/http';
import { forgot } from '@/lib/auth/routes';

export const POST = open(forgot);
