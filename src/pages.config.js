/**
 * pages.config.js - Page routing configuration
 * 
 * This file is AUTO-GENERATED. Do not add imports or modify PAGES manually.
 * Pages are auto-registered when you create files in the ./pages/ folder.
 * 
 * THE ONLY EDITABLE VALUE: mainPage
 * This controls which page is the landing page (shown when users visit the app).
 * 
 * Example file structure:
 * 
 *   import HomePage from './pages/HomePage';
 *   import Dashboard from './pages/Dashboard';
 *   import Settings from './pages/Settings';
 *   
 *   export const PAGES = {
 *       "HomePage": HomePage,
 *       "Dashboard": Dashboard,
 *       "Settings": Settings,
 *   }
 *   
 *   export const pagesConfig = {
 *       mainPage: "HomePage",
 *       Pages: PAGES,
 *   };
 * 
 * Example with Layout (wraps all pages):
 *
 *   import Home from './pages/Home';
 *   import Settings from './pages/Settings';
 *   import __Layout from './Layout.jsx';
 *
 *   export const PAGES = {
 *       "Home": Home,
 *       "Settings": Settings,
 *   }
 *
 *   export const pagesConfig = {
 *       mainPage: "Home",
 *       Pages: PAGES,
 *       Layout: __Layout,
 *   };
 *
 * To change the main page from HomePage to Dashboard, use find_replace:
 *   Old: mainPage: "HomePage",
 *   New: mainPage: "Dashboard",
 *
 * The mainPage value must match a key in the PAGES object exactly.
 */
import Calendar from './pages/Calendar';
import CreatorVault from './pages/CreatorVault';
import Dashboard from './pages/Dashboard';
import Habits from './pages/Habits';
import Ideas from './pages/Ideas';
import Investments from './pages/Investments';
import Media from './pages/Media';
import News from './pages/News';
import Notes from './pages/Notes';
import Projects from './pages/Projects';
import Tasks from './pages/Tasks';
import PromptWizard from './pages/PromptWizard';
import Resources from './pages/Resources';
import Trends from './pages/Trends';
import Tools from './pages/Tools';
import __Layout from './Layout.jsx';


export const PAGES = {
    "Calendar": Calendar,
    "CreatorVault": CreatorVault,
    "Dashboard": Dashboard,
    "Habits": Habits,
    "Ideas": Ideas,
    "Investments": Investments,
    "Media": Media,
    "News": News,
    "Notes": Notes,
    "Projects": Projects,
    "Tasks": Tasks,
    "PromptWizard": PromptWizard,
    "Resources": Resources,
    "Trends": Trends,
    "Tools": Tools,
}

export const pagesConfig = {
    mainPage: "Dashboard",
    Pages: PAGES,
    Layout: __Layout,
};
