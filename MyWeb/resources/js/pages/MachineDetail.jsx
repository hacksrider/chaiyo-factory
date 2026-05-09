import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { publicAPI } from '../api';
import PublicLayout from '../components/PublicLayout';
import BackButton from '../components/BackButton';
import { useLanguage } from '../contexts/LanguageContext';
import { useTranslation } from '../utils/translations';
import { getLocalized } from '../utils/languageHelper';

const MachineDetail = () => {
    const navigate = useNavigate();
    const { id } = useParams();
    const { language } = useLanguage();
    const { t } = useTranslation(language);
    const [machine, setMachine] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchMachine();
    }, [id]);

    const fetchMachine = async () => {
        setLoading(true);
        try {
            const response = await publicAPI.getMachine(id);
            setMachine(response.data);
        } catch (error) {
            console.error('Error fetching machine:', error);
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

    if (!machine) {
        return (
            <PublicLayout>
                <div className="flex justify-center items-center h-screen">
                    <div className="text-xl text-red-600">{t('errors.notFound')}</div>
                </div>
            </PublicLayout>
        );
    }

    return (
        <PublicLayout>
            <div className="h-full bg-gray-50">
                <div className="container mx-auto px-4 py-4">
                    <div className="mb-4">
                        <BackButton to="/machines" label="Back" className="mb-4" />
                        <h1 className="text-2xl font-bold mb-2">{machine.code} - {getLocalized(machine, 'name', language)}</h1>
                    </div>

                    <div className="flex flex-col lg:flex-row gap-6">
                        {/* Machine Layout Image */}
                        <div className="w-full lg:w-8/12">
                            {machine.layout_image && (
                                <div className="bg-white rounded-xl shadow-xl p-6 mb-6 lg:mb-0 border border-gray-100">
                                    <h2 className="text-2xl font-semibold mb-4">{t('machines.machineLayout')}</h2>
                                    <div className="relative w-full bg-gray-100 rounded-lg overflow-hidden">
                                        <img
                                            src={`/storage/${machine.layout_image}`}
                                            alt={t('machines.machineLayout')}
                                            className="w-full h-auto"
                                        />
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Zones */}
                        <div className="w-full lg:w-4/12">
                            <div className="bg-white rounded-xl shadow-xl p-6 border border-gray-100 h-full flex flex-col">
                                <h2 className="text-2xl font-semibold mb-6">{t('machines.zones')}</h2>
                                {machine.zones && machine.zones.length === 0 ? (
                                    <div className="text-center py-12 text-gray-500 flex-grow">
                                        {t('machines.noZones')}
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                        {machine.zones.map((zone) => (
                                            <button
                                                key={zone.id}
                                                onClick={() => navigate(`/machine-zones/${zone.id}`)}
                                                className="bg-green-50 hover:bg-green-100 border-2 border-green-300 rounded-xl px-4 py-3 transition-all duration-300 hover:shadow-lg hover:-translate-y-1 w-full flex flex-col items-center text-center"
                                            >
                                                <div className="text-lg font-semibold text-green-700 mb-2 flex justify-center w-full">
                                                    {zone.code ? `${zone.code} - ` : ''}{getLocalized(zone, 'name', language)}
                                                </div>
                                                {getLocalized(zone, 'description', language) && (
                                                    <div className="text-sm text-gray-600 line-clamp-2">
                                                        {getLocalized(zone, 'description', language)}
                                                    </div>
                                                )}
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

export default MachineDetail;

