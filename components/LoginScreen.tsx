/**
 * Login Screen Component
 * 
 * Renders the login page with Google OAuth button and branding.
 */

import React from 'react';
import { motion } from 'framer-motion';

interface LoginScreenProps {
  onLogin: () => void;
  error: string | null;
  isLoading?: boolean;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ 
  onLogin, 
  error,
  isLoading = false 
}) => {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900/20 to-gray-900 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-gray-800/80 backdrop-blur-sm rounded-2xl p-8 md:p-12 max-w-md w-full shadow-2xl border border-gray-700/50"
      >
        {/* Logo/Brand Section */}
        <div className="text-center mb-8">
          <motion.div
            initial={{ scale: 0.8 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", bounce: 0.5 }}
            className="text-6xl mb-4"
          >
            🦍
          </motion.div>
          <h1 className="text-3xl md:text-4xl font-bold text-white mb-2">
            ChimpNews
          </h1>
          <p className="text-gray-400 text-sm">
            AI-Powered News Broadcasting Studio
          </p>
        </div>

        {/* Login Section */}
        <div className="space-y-4">
          <button
            onClick={onLogin}
            disabled={isLoading}
            className={`w-full flex items-center justify-center gap-3 px-6 py-3 rounded-lg font-medium transition-all
              ${isLoading 
                ? 'bg-gray-600 cursor-not-allowed' 
                : 'bg-white hover:bg-gray-100 active:scale-98'
              }`}
          >
            {isLoading ? (
              <div className="w-5 h-5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
            )}
            <span className="text-gray-800">
              {isLoading ? 'Signing in...' : 'Sign in with Google'}
            </span>
          </button>

          {/* Error Message */}
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-3 bg-red-500/20 border border-red-500/50 rounded-lg"
            >
              <p className="text-red-400 text-sm text-center">{error}</p>
            </motion.div>
          )}
        </div>

        {/* Footer */}
        <div className="mt-8 pt-6 border-t border-gray-700/50">
          <p className="text-gray-500 text-xs text-center">
            Admin access only • Powered by AI
          </p>
        </div>
      </motion.div>
    </div>
  );
};

export default LoginScreen;
