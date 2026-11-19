import { open } from '@/lib/http';
import { whoAmI } from '@/lib/auth/routes';

export const GET = open(whoAmI);
