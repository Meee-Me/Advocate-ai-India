import { open } from '@/lib/http';
import { completeSignIn } from '@/lib/auth/routes';

export const POST = open(completeSignIn);
