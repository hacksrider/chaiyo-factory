import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import AdminLayout from './AdminLayout';
import PublicLayout from './PublicLayout';

/**
 * Layout สำหรับหน้าจัดการที่ทุก role เข้าได้ — admin ใช้ AdminLayout, role อื่นใช้ PublicLayout
 */
const AppPageLayout = ({ children }) => {
    const { isAdmin } = useAuth();
    const Layout = isAdmin ? AdminLayout : PublicLayout;
    return <Layout>{children}</Layout>;
};

export default AppPageLayout;
