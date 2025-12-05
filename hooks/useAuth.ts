/**
 * Authentication Hook
 * 
 * Handles user authentication state and operations with Supabase Auth.
 */

import { useState, useEffect, useCallback } from 'react';
import { UserProfile } from '../types';
import { signInWithGoogle, getSession, signOut, supabase } from '../services/supabaseService';
import { logger } from '../services/logger';

const getAdminEmail = () => 
  import.meta.env.VITE_ADMIN_EMAIL || 
  (window as any).env?.ADMIN_EMAIL || 
  process.env.ADMIN_EMAIL || 
  "";

interface UseAuthReturn {
  user: UserProfile | null;
  isLoading: boolean;
  isAdmin: boolean;
  loginError: string | null;
  login: () => Promise<void>;
  logout: () => Promise<void>;
}

export function useAuth(): UseAuthReturn {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loginError, setLoginError] = useState<string | null>(null);

  // Check if user is admin
  const isAdmin = user?.email === getAdminEmail();

  // Initialize auth state on mount
  useEffect(() => {
    const initAuth = async () => {
      try {
        const session = await getSession();
        if (session?.user) {
          const adminEmail = getAdminEmail();
          if (adminEmail && session.user.email !== adminEmail) {
            logger.warn('auth', 'Non-admin user attempted login', { 
              email: session.user.email 
            });
            await signOut();
            setUser(null);
          } else {
            setUser({
              email: session.user.email || '',
              name: session.user.user_metadata?.full_name || session.user.email || '',
              picture: session.user.user_metadata?.avatar_url || '',
              accessToken: session.provider_token || ''
            });
            logger.info('auth', 'User session restored', { 
              email: session.user.email 
            });
          }
        }
      } catch (error) {
        logger.error('auth', 'Failed to initialize auth', { error });
      } finally {
        setIsLoading(false);
      }
    };

    initAuth();

    // Listen for auth state changes
    const { data: authListener } = supabase?.auth.onAuthStateChange((event, session) => {
      if (session?.user) {
        const adminEmail = getAdminEmail();
        if (adminEmail && session.user.email !== adminEmail) {
          logger.warn('auth', 'Non-admin login rejected');
          supabase?.auth.signOut();
          setUser(null);
        } else {
          setUser({
            email: session.user.email || '',
            name: session.user.user_metadata?.full_name || session.user.email || '',
            picture: session.user.user_metadata?.avatar_url || '',
            accessToken: session.provider_token || ''
          });
          logger.info('auth', 'Auth state changed', { event, email: session.user.email });
        }
      } else {
        setUser(null);
      }
    }) || { data: { subscription: { unsubscribe: () => {} } } };

    return () => {
      authListener?.subscription.unsubscribe();
    };
  }, []);

  // Login handler
  const login = useCallback(async () => {
    setLoginError(null);
    try {
      await signInWithGoogle();
      logger.info('auth', 'Login initiated');
    } catch (error) {
      const message = (error as Error).message;
      setLoginError(message);
      logger.error('auth', 'Login failed', { error: message });
    }
  }, []);

  // Logout handler
  const logout = useCallback(async () => {
    try {
      await signOut();
      setUser(null);
      logger.info('auth', 'User logged out');
    } catch (error) {
      logger.error('auth', 'Logout failed', { error });
    }
  }, []);

  return {
    user,
    isLoading,
    isAdmin,
    loginError,
    login,
    logout
  };
}
