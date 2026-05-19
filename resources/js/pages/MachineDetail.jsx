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
                <div className="flex min-h-0 w-full min-w-0 flex-1 items-center justify-center bg-gray-50 px-4">
                    <div className="text-lg sm:text-xl">{t('common.loading')}</div>
                </div>
            </PublicLayout>
        );
    }

    if (!machine) {
        return (
            <PublicLayout>
                <div className="flex min-h-0 w-full min-w-0 flex-1 items-center justify-center bg-gray-50 px-4">
                    <div className="text-lg text-red-600 sm:text-xl">{t('errors.notFound')}</div>
                </div>
            </PublicLayout>
        );
    }

    return (
        <PublicLayout>
            <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-x-hidden bg-gray-50">
                <div className="w-full px-3 py-4 sm:px-4 sm:py-6 lg:px-6">
                    <div className="mb-4">
                        <BackButton to="/machines" label="Back" className="mb-4" />
                        <h1 className="mb-2 text-xl font-bold sm:text-2xl">{machine.code} - {getLocalized(machine, 'name', language)}</h1>
                    </div>

                    <div className="flex flex-col gap-5 lg:flex-row lg:gap-6">
                        {/* Machine Layout Image */}
                        <div className="w-full lg:w-8/12">
                            {machine.layout_image && (
                                <div className="mb-6 rounded-xl border border-gray-100 bg-white p-4 shadow-xl sm:p-6 lg:mb-0">
                                    <h2 className="mb-4 text-xl font-semibold sm:text-2xl">{t('machines.machineLayout')}</h2>
                                    <div className="w-full overflow-x-auto rounded-lg bg-gray-100">
                                        <img
                                            src={`/storage/${machine.layout_image}`}
                                            alt={t('machines.machineLayout')}
                                            className="mx-auto block h-auto w-full min-w-[400px] max-w-none sm:min-w-0 sm:max-w-full"
                                        />
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Zones */}
                        <div className="w-full lg:w-4/12">
                            <div className="flex h-full flex-col rounded-xl border border-gray-100 bg-white p-4 shadow-xl sm:p-6">
                                <h2 className="mb-6 text-xl font-semibold sm:text-2xl">{t('machines.zones')}</h2>
                                {machine.zones && machine.zones.length === 0 ? (
                                    <div className="text-center py-12 text-gray-500 flex-grow">
                                        {t('machines.noZones')}
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-1 gap-4 min-[520px]:grid-cols-2 lg:grid-cols-3">
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

