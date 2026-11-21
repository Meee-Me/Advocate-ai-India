import { open } from '@/lib/http';
import { logout } from '@/lib/auth/routes';

export const POST = open(logout);
