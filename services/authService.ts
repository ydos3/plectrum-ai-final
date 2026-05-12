
import { User, SkillLevel } from '../types';

const USER_KEY = 'plexdrum_user_v2';

export const getCurrentUser = (): User | null => {
  const data = localStorage.getItem(USER_KEY);
  return data ? JSON.parse(data) : null;
};

export const login = async (name: string, skillLevel: SkillLevel): Promise<User> => {
  // Simple ID generation based on timestamp
  const id = `user_${Date.now()}`;
  
  const user: User = {
    id,
    name,
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
