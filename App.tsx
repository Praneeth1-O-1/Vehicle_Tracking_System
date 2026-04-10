import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LanguageProvider } from './src/i18n/i18n';
import LoginScreen from './src/screens/LoginScreen';
import DashboardScreen from './src/screens/DashboardScreen';
import ReasonScreen from './src/screens/ReasonScreen';
import RejectTaskScreen from './src/screens/RejectTaskScreen';
import TaskDetailScreen from './src/screens/TaskDetailScreen';
import AudioMessagesScreen from './src/screens/AudioMessagesScreen';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';

const Stack = createStackNavigator();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: 1000 * 60 * 60 * 24, // 24 hours
    },
  },
});

const persister = createAsyncStoragePersister({
  storage: AsyncStorage,
});

export default function App() {
  return (
    <LanguageProvider>
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{ persister }}
      >
        <SafeAreaProvider>
          <NavigationContainer>
            <Stack.Navigator initialRouteName="Login">
              <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
              <Stack.Screen name="Dashboard" component={DashboardScreen} options={{ headerShown: false }} />
              <Stack.Screen name="Reason" component={ReasonScreen} options={{ headerShown: false }} />
              <Stack.Screen name="RejectTask" component={RejectTaskScreen} options={{ headerShown: false }} />
              <Stack.Screen name="TaskDetail" component={TaskDetailScreen} options={{ headerShown: false }} />
              <Stack.Screen name="AudioMessages" component={AudioMessagesScreen} options={{ headerShown: false }} />
            </Stack.Navigator>
          </NavigationContainer>
        </SafeAreaProvider>
      </PersistQueryClientProvider>
    </LanguageProvider>
  );
}
