import React from 'react';
import { Toaster } from 'react-hot-toast';

/**
 * Toast Notifications Wrapper
 * Pre-configured with ChimpNews branding
 */
export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    return (
        <>
            {children}
            <Toaster
                position="top-right"
                toastOptions={{
                    // Default options
                    duration: 3000,
                    style: {
                        background: '#1a1a1a',
                        color: '#fff',
                        border: '1px solid #333',
                        borderRadius: '12px',
                        padding: '16px',
                        fontSize: '14px',
                        fontFamily: 'var(--font-sans)',
                        boxShadow: 'var(--shadow-xl)',
                    },
                    // Success
                    success: {
                        duration: 3000,
                        style: {
                            background: '#166534',
                            border: '1px solid #22c55e',
                        },
                        iconTheme: {
                            primary: '#22c55e',
                            secondary: '#fff',
                        },
                    },
                    // Error
                    error: {
                        duration: 4000,
                        style: {
                            background: '#991b1b',
                            border: '1px solid #ef4444',
                        },
                        iconTheme: {
                            primary: '#ef4444',
                            secondary: '#fff',
                        },
                    },
                    // Loading
                    loading: {
                        style: {
                            background: '#1e40af',
                            border: '1px solid #3b82f6',
                        },
                        iconTheme: {
                            primary: '#3b82f6',
                            secondary: '#fff',
                        },
                    },
                }}
            />
        </>
    );
};
