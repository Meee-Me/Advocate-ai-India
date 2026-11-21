import { open } from '@/lib/http';
import { confirm } from '@/lib/auth/routes';

export const GET = open(confirm);
