
import { User, SkillLevel } from '../types';

const USER_KEY = 'plexdrum_user_v2';

export const getCurrentUser = (): User | null => {
  const data = localStorage.getItem(USER_KEY);
  return data ? JSON.parse(data) : null;
};

export const login = async (name: string, skillLevel: SkillLevel, email?: string): Promise<User> => {
  const normalizedEmail = email?.trim().toLowerCase() || undefined;
  // Stable id derived from the email when present (so the same account restores
  // its library across logins on this device), else a timestamp for guests.
  const id = normalizedEmail ? `user_${normalizedEmail}` : `user_${Date.now()}`;

  const user: User = {
    id,
    name,
    email: normalizedEmail,
    skillLevel,
    subscriptionStatus: 'active', // Default to active/premium for this version
    trialEndDate: Date.now() + (365 * 24 * 60 * 60 * 1000),
    isAdmin: false
  };
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  return user;
};

export const logout = () => {
  localStorage.removeItem(USER_KEY);
};

export const processPayment = async (amount: number, currency: string): Promise<boolean> => {
  // Simulate UPI payment processing
  return new Promise((resolve) => {
    setTimeout(() => {
        const user = getCurrentUser();
        if (user) {
            user.subscriptionStatus = 'active';
            localStorage.setItem(USER_KEY, JSON.stringify(user));
        }
        resolve(true);
    }, 2000);
  });
};
