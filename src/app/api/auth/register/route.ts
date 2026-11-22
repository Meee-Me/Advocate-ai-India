import { open } from '@/lib/http';
import { register } from '@/lib/auth/routes';

export const POST = open(register);
