import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { publicAPI } from '../api';
import PublicLayout from '../components/PublicLayout';
import BackButton from '../components/BackButton';
import { useLanguage } from '../contexts/LanguageContext';
import { useTranslation } from '../utils/translations';
import { getLocalized } from '../utils/languageHelper';

const MachinesMode = () => {
    const navigate = useNavigate();
    const { language } = useLanguage();
    const { t } = useTranslation(language);
    const [machines, setMachines] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchMachines();
    }, []);

    const fetchMachines = async () => {
        try {
            const response = await publicAPI.getMachines();
            setMachines(response.data);
        } catch (error) {
            console.error('Error fetching machines:', error);
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return (
            <PublicLayout>
                <div className="flex justify-center items-center h-screen">
                    <div className="text-xl">{t('common.loading')}</div>
                </div>
            </PublicLayout>
        );
    }

    return (
        <PublicLayout>
            <div className="h-full bg-gray-50">
                <div className="container mx-auto px-4 py-3">
                        <BackButton to="/" label="Back" className="mb-4" />
                    
                    <div className="flex flex-col lg:flex-row gap-8 mb-8">
                        {/* Factory Layout Image - 9 columns on lg+ */}
                        <div className="w-full lg:w-9/12">
                            <div className="bg-white rounded-xl shadow-xl p-6 h-full border border-gray-100">
                                <h2 className="text-2xl font-semibold mb-4">{t('machines.factoryLayout')}</h2>
                                <div className="relative w-full flex justify-center bg-gray-100 rounded-lg overflow-hidden">
                                    <img
                                        src="/images/Factory-layout.png"
                                        alt={t('machines.factoryLayout')}
                                        className="max-w-8xl w-full h-auto"
                                        onError={(e) => {
                                            e.target.style.display = 'none';
                                            e.target.nextSibling.style.display = 'block';
                                        }}
                                    />
                                    <div className="hidden text-center py-12 text-gray-500">
                                        {t('errors.notFound')}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Machines List - 3 columns on lg+ */}
                        <div className="w-full lg:w-3/12">
                            <div className="bg-white rounded-xl shadow-xl p-6 border border-gray-100 h-full flex flex-col">
                                <h2 className="text-2xl font-semibold mb-6">{t('machines.allMachines')}</h2>
                                {machines.length === 0 ? (
                                    <div className="text-center py-12 text-gray-500 flex-grow">
                                        {t('machines.noMachines')}
                                    </div>
                                ) : (
                                    // NOTE: ตรงนี้ flex-wrap, gap, และปุ่มไม่ได้สูงเต็มพื้นที่
                                    <div className="flex flex-wrap gap-3 justify-center">
                                        {machines.map((machine) => (
                                            <button
                                                key={machine.id}
                                                onClick={() => navigate(`/machines/${machine.id}`)}
                                                className="bg-blue-50 hover:bg-blue-100 border-2 border-blue-300 rounded-xl p-4 text-center transition-all duration-300 hover:shadow-lg hover:-translate-y-1 min-w-[120px] max-w-full"
                                                style={{ flex: '0 1 45%' }}
                                            >
                                                <div className="text-lg font-semibold text-blue-700 mb-1">
                                                    {machine.code}
                                                </div>
                                                <div className="text-sm text-gray-600">
                                                    {getLocalized(machine, 'name', language)}
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </PublicLayout>
    );
};

export default MachinesMode;

