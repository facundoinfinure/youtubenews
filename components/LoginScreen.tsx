/**
 * Login Screen Component
 * 
 * Premium login page with Google OAuth button and branding.
 * Redesigned for world-class UX with glassmorphism and animations.
 */

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface LoginScreenProps {
  onLogin: () => void;
  error: string | null;
  isLoading?: boolean;
}

// Google Icon SVG
const GoogleIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24">
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
);

export const LoginScreen: React.FC<LoginScreenProps> = ({ 
  onLogin, 
  error,
  isLoading = false 
}) => {
  return (
    <div className="min-h-screen bg-[#09090b] flex items-center justify-center p-6 relative overflow-hidden">
      {/* Background gradient orbs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1 }}
          className="absolute -top-40 -right-40 w-[500px] h-[500px] bg-accent-500/10 rounded-full blur-[120px]" 
        />
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1, delay: 0.2 }}
          className="absolute -bottom-40 -left-40 w-[500px] h-[500px] bg-violet-500/10 rounded-full blur-[120px]" 
        />
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1, delay: 0.4 }}
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-accent-500/5 rounded-full blur-[150px]" 
        />
      </div>

      {/* Main Card */}
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="relative w-full max-w-sm"
      >
        {/* Card with glassmorphism */}
        <div className="bg-white/[0.03] backdrop-blur-2xl rounded-3xl p-10 border border-white/10 shadow-2xl">
          
          {/* Logo */}
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.2, type: "spring", bounce: 0.4 }}
            className="relative w-20 h-20 mx-auto mb-8"
          >
            {/* Glow effect */}
            <div className="absolute inset-0 bg-gradient-to-br from-accent-400 to-accent-600 rounded-2xl blur-xl opacity-50" />
            {/* Logo container */}
            <div className="relative w-full h-full rounded-2xl bg-gradient-to-br from-accent-400 to-accent-600 flex items-center justify-center shadow-xl">
              <span className="text-4xl">🦍</span>
            </div>
          </motion.div>

          {/* Title */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.4 }}
            className="text-center mb-10"
          >
            <h1 className="text-2xl font-semibold text-white mb-2">
              Welcome to ChimpNews
            </h1>
            <p className="text-sm text-white/50">
              AI-Powered News Broadcasting Studio
            </p>
          </motion.div>

          {/* Login Button */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.4 }}
          >
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={onLogin}
              disabled={isLoading}
              className={`
                w-full h-12 rounded-xl font-medium text-[#09090b]
                flex items-center justify-center gap-3
                transition-all duration-200
                ${isLoading 
                  ? 'bg-white/50 cursor-not-allowed' 
                  : 'bg-white hover:bg-gray-100 shadow-lg shadow-white/10 hover:shadow-xl hover:shadow-white/20'
                }
              `}
            >
              {isLoading ? (
                <div className="w-5 h-5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
              ) : (
                <GoogleIcon className="w-5 h-5" />
              )}
              <span>
                {isLoading ? 'Signing in...' : 'Continue with Google'}
              </span>
            </motion.button>
          </motion.div>

          {/* Error Message */}
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, height: 0, marginTop: 0 }}
                animate={{ opacity: 1, height: 'auto', marginTop: 16 }}
                exit={{ opacity: 0, height: 0, marginTop: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
                  <p className="text-red-400 text-sm text-center">{error}</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Divider */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
            className="mt-8 pt-6 border-t border-white/5"
          >
            <p className="text-white/30 text-xs text-center">
              Secure authentication powered by Google
            </p>
          </motion.div>
        </div>

        {/* Footer */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
          className="text-xs text-white/20 text-center mt-6"
        >
          Admin access only • Powered by AI
        </motion.p>
      </motion.div>

      {/* Keyboard hint */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1 }}
        className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 text-xs text-white/20"
      >
        <kbd className="px-2 py-1 bg-white/5 rounded text-white/30 font-mono">Enter</kbd>
        <span>to sign in</span>
      </motion.div>
    </div>
  );
};

export default LoginScreen;
