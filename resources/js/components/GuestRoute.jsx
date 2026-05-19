import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

/**
 * For routes only anonymous users may see (e.g. login).
 * Authenticated users are redirected away.
 */
const GuestRoute = ({ children }) => {
    const { user, loading } = useAuth();

    if (loading) {
        return (
            <div className="flex justify-center items-center h-screen">
                <div className="text-xl">กำลังโหลด...</div>
            </div>
        );
    }

    if (user) {
        const to = user.role === 'admin' ? '/admin/problems' : '/';
        return <Navigate to={to} replace />;
    }

    return children;
};

export default GuestRoute;
