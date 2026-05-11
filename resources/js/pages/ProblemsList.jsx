import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { publicAPI } from '../api';
import PublicLayout from '../components/PublicLayout';
import BackButton from '../components/BackButton';
import { useLanguage } from '../contexts/LanguageContext';
import { useTranslation } from '../utils/translations';
import { getLocalized } from '../utils/languageHelper';

const ProblemsList = () => {
    const navigate = useNavigate();
    const { language } = useLanguage();
    const { t } = useTranslation(language);
    const [searchParams, setSearchParams] = useSearchParams();
    const [problems, setProblems] = useState([]);
    const [categories, setCategories] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState(searchParams.get('search') || '');
    const [selectedCategory, setSelectedCategory] = useState(searchParams.get('category') || '');

    useEffect(() => {
        fetchCategories();
    }, []);

    useEffect(() => {
        fetchProblems();
    }, [search, selectedCategory]);

    const fetchCategories = async () => {
        try {
            const response = await publicAPI.getCategories();
            setCategories(response.data);
        } catch (error) {
            console.error('Error fetching categories:', error);
        }
    };

    const fetchProblems = async () => {
        setLoading(true);
        try {
            const params = {};
            if (search) params.search = search;
            if (selectedCategory) params.category_id = selectedCategory;

            const response = await publicAPI.getProblems(params);
            
            // Handle both paginated and non-paginated responses
            let problemsData = [];
            if (response.data) {
                if (Array.isArray(response.data)) {
                    // Non-paginated response
                    problemsData = response.data;
                } else if (response.data.data && Array.isArray(response.data.data)) {
                    // Paginated response
                    problemsData = response.data.data;
                } else if (Array.isArray(response.data)) {
                    problemsData = response.data;
                }
            }
            
            setProblems(problemsData);
            
            // Update URL
            const newParams = new URLSearchParams();
            if (search) newParams.set('search', search);
            if (selectedCategory) newParams.set('category', selectedCategory);
            setSearchParams(newParams);
        } catch (error) {
            console.error('Error fetching problems:', error);
            setProblems([]);
        } finally {
            setLoading(false);
        }
    };

    const handleSearch = (e) => {
        e.preventDefault();
        fetchProblems();
    };

    return (
        <PublicLayout>
            <div className="min-h-0 bg-gray-50">
                <div className="mx-auto w-full max-w-[1920px] px-3 py-4 sm:px-4 lg:px-6 sm:py-5">
                    <div className="mb-4">
                        <BackButton to="/" label="Back" className="mb-4" />
                        <h1 className="mb-2 text-xl font-bold text-gray-800 sm:text-2xl">{t('problems.title')}</h1>
                    </div>
                {/* Search and Filter */}
                <div className="mb-4 rounded-xl border border-gray-100 bg-white p-4 shadow-lg sm:p-6">
                    <form onSubmit={handleSearch} className="mb-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:gap-4">
                            <input
                                type="text"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder={t('problems.searchPlaceholder')}
                                className="w-full flex-1 rounded-lg border border-gray-300 px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 sm:py-2"
                            />
                            <button
                                type="submit"
                                className="w-full shrink-0 rounded-lg bg-blue-600 px-6 py-2.5 text-white hover:bg-blue-700 sm:w-auto"
                            >
                                {t('common.search')}
                            </button>
                        </div>
                    </form>

                    <div className="flex flex-wrap gap-2 sm:gap-2">
                        <button
                            onClick={() => {
                                setSelectedCategory('');
                                setSearch('');
                            }}
                            className={`px-4 py-2 rounded-lg ${
                                !selectedCategory
                                    ? 'bg-blue-600 text-white'
                                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                            }`}
                        >
                            {t('common.all')}
                        </button>
                        {categories.map((category) => (
                            <button
                                key={category.id}
                                onClick={() => setSelectedCategory(category.id.toString())}
                                className={`px-4 py-2 rounded-lg ${
                                    selectedCategory === category.id.toString()
                                        ? 'bg-blue-600 text-white'
                                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                                }`}
                            >
                                {getLocalized(category, 'name', language)}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Problems List */}
                {loading ? (
                    <div className="text-center py-12">
                        <div className="text-xl">{t('common.loading')}</div>
                    </div>
                ) : problems.length === 0 ? (
                    <div className="text-center py-12">
                        <div className="text-xl text-gray-500">{t('problems.noProblems')}</div>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 xl:grid-cols-3 3xl:grid-cols-4 xl:gap-6">
                        {problems.map((problem) => {
                            // Check if this is a machine zone problem
                            const isMachineZoneProblem = problem.is_machine_zone_problem === true;
                            
                            const handleClick = () => {
                                if (isMachineZoneProblem) {
                                    // Navigate to machine zone problem detail
                                    navigate(`/machine-zone-problems/${problem.id}`, {
                                        state: { from: '/problems' }
                                    });
                                } else {
                                    // Navigate to normal problem detail
                                    navigate(`/problems/${problem.id}`, {
                                        state: { from: '/problems' }
                                    });
                                }
                            };

                            // Get category name or machine info
                            const categoryName = isMachineZoneProblem 
                                ? t('machines.title')
                                : getLocalized(problem.category, 'name', language) || t('machines.title');
                            
                            // For machine zone problems, show machine and zone info
                            const machineName = isMachineZoneProblem && problem.machine 
                                ? getLocalized(problem.machine, 'name', language) || problem.machine.code
                                : null;
                            const zoneName = isMachineZoneProblem && problem.zone
                                ? getLocalized(problem.zone, 'name', language) || problem.zone.code || t('machines.zones')
                                : null;
                            const machineInfo = machineName && zoneName
                                ? `${problem.machine.code || machineName} → ${problem.zone.code || zoneName}`
                                : null;

                            const getVideoUrl = (path) => {
                                if (!path) return null;
                                return `/storage/${path}`;
                            };

                            return (
                                <div
                                    key={isMachineZoneProblem ? `machine-zone-${problem.id}` : `problem-${problem.id}`}
                                    onClick={handleClick}
                                    className="bg-white rounded-xl shadow-md overflow-hidden cursor-pointer hover:shadow-xl hover:-translate-y-1 transition-all duration-300 border border-gray-100"
                                >
                                    <div className="grid grid-cols-1 min-[480px]:grid-cols-2 gap-0">
                                        {/* คอลัมน์แรก: วิดีโอปัญหา */}
                                        <div className="relative bg-gray-100" style={{ paddingBottom: '75%' }}>
                                            {problem.video_path ? (
                                                <video
                                                    className="absolute top-0 left-0 w-full h-full object-cover"
                                                    src={getVideoUrl(problem.video_path)}
                                                    controls
                                                    playsInline
                                                />
                                            ) : (
                                                <div className="absolute top-0 left-0 w-full h-full flex items-center justify-center text-gray-400 text-xs">
                                                    {t('problems.noVideo')}
                                                </div>
                                            )}
                                        </div>
                                        
                                        {/* คอลัมน์สอง: ข้อมูลปัญหา */}
                                        <div className="p-3 flex flex-col">
                                            <div className="flex items-center justify-between mb-2">
                                                <span className={`text-xs px-2 py-0.5 rounded-full ${
                                                    isMachineZoneProblem 
                                                        ? 'text-green-600 bg-green-50' 
                                                        : 'text-blue-600 bg-blue-50'
                                                }`}>
                                                    {categoryName}
                                                </span>
                                                <span className="text-xs text-gray-500">
                                                    👁️ {problem.views || 0}
                                                </span>
                                            </div>
                                            
                                            {/* Machine and Zone Info for machine zone problems */}
                                            {isMachineZoneProblem && machineInfo && (
                                                <div className="mb-2">
                                                    <div className="text-xs text-green-700 font-medium bg-green-50 px-2 py-0.5 rounded inline-block">
                                                        📍 {machineInfo}
                                                    </div>
                                                </div>
                                            )}
                                            
                                            <h3 className="text-base font-semibold mb-1 line-clamp-2">{getLocalized(problem, 'title', language)}</h3>
                                            <p className="text-xs text-gray-600 line-clamp-3 mb-2 flex-grow">
                                                {getLocalized(problem, 'description', language)}
                                            </p>
                                            <div className={`text-xs font-medium mt-auto ${
                                                isMachineZoneProblem ? 'text-green-600' : 'text-blue-600'
                                            }`}>
                                                {t('common.viewDetails')} →
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
                </div>
            </div>
        </PublicLayout>
    );
};

export default ProblemsList;

