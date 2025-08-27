"use client";

import React, { createContext, useContext, ReactNode } from 'react';
import translations from '@/lib/localization/en.json'; // Import the strings

// Define a type for the translation function
type TFunction = (key: string) => string;

// Create the context
const LocalizationContext = createContext<TFunction | undefined>(undefined);

// Helper function to get nested values from the JSON object
function getNestedValue(obj: any, key: string): string {
    return key.split('.').reduce((acc, part) => acc && acc[part], obj) || key;
}

/**
 * Provides a translation function 't' to all child components.
 * This should wrap the main application layout.
 */
export function LocalizationProvider({ children }: { children: ReactNode }) {
    const t: TFunction = (key: string) => {
        return getNestedValue(translations, key);
    };

    return (
        <LocalizationContext.Provider value={t}>
            {children}
        </LocalizationContext.Provider>
    );
}

/**
 * Custom hook to access the translation function 't' from any component.
 * Must be used within a LocalizationProvider.
 * @example const t = useLocalization();
 *          <p>{t('some.key')}</p>
 */
export function useLocalization() {
    const context = useContext(LocalizationContext);
    if (context === undefined) {
        throw new Error('useLocalization must be used within a LocalizationProvider');
    }
    return context;
}