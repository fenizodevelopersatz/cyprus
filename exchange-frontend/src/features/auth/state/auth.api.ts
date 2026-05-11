import api from "../../../app/axios";
import { API_ROUTES } from "../../../app/apiRoutes";
import type { LoginResp, User } from "../types";

export const apiRegister = (name: string, email: string, password: string, country: string): Promise<User> =>
  api.post(API_ROUTES.auth.register, { name, email, password, country }).then(r => r.data);

export const apiLogin = (email: string, password: string): Promise<LoginResp> =>
  api.post(API_ROUTES.auth.login, { email, password }).then(r => r.data);

export const apiMe = (): Promise<User> =>
  api.get(API_ROUTES.auth.me).then(r => r.data);
