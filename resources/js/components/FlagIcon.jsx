import React from 'react';

const FlagIcon = ({ countryCode, className = '' }) => {
    const flags = {
        th: '/images/thailand.png',
        mm: '/images/myanmar.png',
    };

    const flagPath = flags[countryCode];
    
    if (!flagPath) return null;

    return (
        <img 
            src={flagPath} 
            alt={`${countryCode} flag`}
            className={className}
            style={{ 
                objectFit: 'contain',
                width: '100%',
                height: '100%',
                display: 'block',
            }}
            loading="eager"
        />
    );
};

export default FlagIcon;

