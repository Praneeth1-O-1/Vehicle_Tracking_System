# LogiTrack Mobile App

A React Native (Expo) app for drivers to manage deliveries offline-first.

## 📱 Features

- **Dashboard**: Displays all assigned shipments in a scrollable list.
- **Action Buttons**: Single-tap status updates (Pickup -> Delivery).
- **Offline Support**: Uses `AsyncStorage` + TanStack Query to cache data indefinitely.
- **Real-time**: Listens for socket events to update the dashboard instantly.

## 🛠️ Setup

1.  **Install Dependencies**:
    ```bash
    npm install
    ```

2.  **Start Metro Bundler**:
    ```bash
    npx expo start
    ```
    - Press `a` for Android Emulator.
    - Press `i` for iOS Simulator.

## 📍 Key Components

- **DashboardScreen**: Main view. Handles `useQuery` for fetching assignments and `socket.on('new_assignment')` for real-time updates.
- **LoginScreen**: Handles authentication and stores JWT in `SecureStore`.
- **App.tsx**: Configures `PersistQueryClientProvider` for offline caching.

## ⚠️ Notes for Testing

- **Android Emulator**: Uses `10.0.2.2` to connect to localhost backend.
- **iOS Simulator**: Uses `localhost`.
- **GPS Mocking**: If testing on emulator, you may need to set a mock location or the app will use fallback coordinates `(0,0)` after 5 seconds.
