import './bootstrap';
import '../css/app.css';

import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { LanguageProvider } from './contexts/LanguageContext';
import { AlertProvider } from './contexts/AlertContext';
import ProtectedRoute from './components/ProtectedRoute';
import GuestRoute from './components/GuestRoute';

// Pages
import Landing from './pages/Landing';
import Login from './pages/Login';
import ProblemsList from './pages/ProblemsList';
import ProblemDetail from './pages/ProblemDetail';
import MachinesMode from './pages/MachinesMode';
import MachineDetail from './pages/MachineDetail';
import MachineZoneDetail from './pages/MachineZoneDetail';
import MachineZoneProblemDetail from './pages/MachineZoneProblemDetail';

// Production Monitoring
import ProductionMonitoring from './features/production-monitoring/index';

// Admin Pages
import ProblemsManagement from './pages/admin/ProblemsManagement';
import CategoriesManagement from './pages/admin/CategoriesManagement';
import UsersManagement from './pages/admin/UsersManagement';
import PageContentsManagement from './pages/admin/PageContentsManagement';
import MachinesManagement from './pages/admin/MachinesManagement';

function App() {
    return (
        <LanguageProvider>
            <AuthProvider>
                <AlertProvider>
                    <BrowserRouter>
                <Routes>
                    <Route
                        path="/"
                        element={
                            <ProtectedRoute>
                                <Landing />
                            </ProtectedRoute>
                        }
                    />
                    <Route
                        path="/problems"
                        element={
                            <ProtectedRoute>
                                <ProblemsList />
                            </ProtectedRoute>
                        }
                    />
                    <Route
                        path="/problems/:id"
                        element={
                            <ProtectedRoute>
                                <ProblemDetail />
                            </ProtectedRoute>
                        }
                    />
                    <Route
                        path="/machines"
                        element={
                            <ProtectedRoute>
                                <MachinesMode />
                            </ProtectedRoute>
                        }
                    />
                    <Route
                        path="/machines/:id"
                        element={
                            <ProtectedRoute>
                                <MachineDetail />
                            </ProtectedRoute>
                        }
                    />
                    <Route
                        path="/machine-zones/:id"
                        element={
                            <ProtectedRoute>
                                <MachineZoneDetail />
                            </ProtectedRoute>
                        }
                    />
                    <Route
                        path="/machine-zone-problems/:id"
                        element={
                            <ProtectedRoute>
                                <MachineZoneProblemDetail />
                            </ProtectedRoute>
                        }
                    />
                    <Route
                        path="/production-monitoring/led-sign/:machineId"
                        element={
                            <ProtectedRoute>
                                <ProductionMonitoring />
                            </ProtectedRoute>
                        }
                    />
                    <Route
                        path="/production-monitoring"
                        element={
                            <ProtectedRoute>
                                <ProductionMonitoring />
                            </ProtectedRoute>
                        }
                    />

                    <Route
                        path="/admin/login"
                        element={
                            <GuestRoute>
                                <Login />
                            </GuestRoute>
                        }
                    />
                    <Route
                        path="/admin/problems"
                        element={
                            <ProtectedRoute requireAdmin={true}>
                                <ProblemsManagement />
                            </ProtectedRoute>
                        }
                    />
                    <Route
                        path="/admin/categories"
                        element={
                            <ProtectedRoute requireAdmin={true}>
                                <CategoriesManagement />
                            </ProtectedRoute>
                        }
                    />
                    <Route
                        path="/admin/users"
                        element={
                            <ProtectedRoute requireAdmin={true}>
                                <UsersManagement />
                            </ProtectedRoute>
                        }
                    />
                    <Route
                        path="/admin/page-contents"
                        element={
                            <ProtectedRoute requireAdmin={true}>
                                <PageContentsManagement />
                            </ProtectedRoute>
                        }
                    />
                    <Route
                        path="/admin/machines"
                        element={
                            <ProtectedRoute requireAdmin={true}>
                                <MachinesManagement />
                            </ProtectedRoute>
                        }
                    />
                    
                    {/* Catch all */}
                    <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
                    </BrowserRouter>
                </AlertProvider>
            </AuthProvider>
        </LanguageProvider>
    );
}

// Render React
if (document.getElementById('app')) {
    const root = ReactDOM.createRoot(document.getElementById('app'));
    root.render(<App />);
}
