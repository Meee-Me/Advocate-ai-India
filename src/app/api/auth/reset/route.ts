import { open } from '@/lib/http';
import { reset } from '@/lib/auth/routes';

export const POST = open(reset);
