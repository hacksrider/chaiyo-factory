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
            <div className="min-h-0 bg-gray-50">
                <div className="mx-auto w-full max-w-[1920px] px-3 py-4 sm:px-4 lg:px-6 sm:py-5">
                        <BackButton to="/" label="Back" className="mb-4" />
                    
                    <div className="mb-8 flex flex-col gap-6 lg:flex-row lg:gap-8">
                        {/* Factory Layout Image - 9 columns on lg+ */}
                        <div className="w-full lg:w-9/12">
                            <div className="h-full rounded-xl border border-gray-100 bg-white p-4 shadow-xl sm:p-6">
                                <h2 className="mb-4 text-xl font-semibold sm:text-2xl">{t('machines.factoryLayout')}</h2>
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
                            <div className="flex h-full flex-col rounded-xl border border-gray-100 bg-white p-4 shadow-xl sm:p-6">
                                <h2 className="mb-4 text-xl font-semibold sm:mb-6 sm:text-2xl">{t('machines.allMachines')}</h2>
                                {machines.length === 0 ? (
                                    <div className="text-center py-12 text-gray-500 flex-grow">
                                        {t('machines.noMachines')}
                                    </div>
                                ) : (
                                    // NOTE: ตรงนี้ flex-wrap, gap, และปุ่มไม่ได้สูงเต็มพื้นที่
                                    <div className="flex flex-wrap justify-center gap-3 sm:gap-3 lg:justify-start">
                                        {machines.map((machine) => (
                                            <button
                                                type="button"
                                                key={machine.id}
                                                onClick={() => navigate(`/machines/${machine.id}`)}
                                                className="min-h-[88px] w-full rounded-xl border-2 border-blue-300 bg-blue-50 px-4 py-3 text-center transition-all duration-300 hover:-translate-y-1 hover:bg-blue-100 hover:shadow-lg sm:w-[calc(50%-0.375rem)] lg:w-full"
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

