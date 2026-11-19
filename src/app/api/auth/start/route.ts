import { open } from '@/lib/http';
import { startSignIn } from '@/lib/auth/routes';

export const GET = open(startSignIn);
