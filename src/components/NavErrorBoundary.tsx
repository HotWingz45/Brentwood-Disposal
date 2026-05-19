import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';

interface State {
  error: Error | null;
}

export class NavErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[NavErrorBoundary] Caught:', error.message);
    console.error('[NavErrorBoundary] Component stack:', info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <View style={styles.container}>
          <Text style={styles.title}>NAV SDK CRASH</Text>
          <ScrollView>
            <Text style={styles.message}>{this.state.error.message}</Text>
            <Text style={styles.stack}>{this.state.error.stack}</Text>
          </ScrollView>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ff0000',
    padding: 16,
    paddingTop: 60,
  },
  title: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  message: {
    color: '#fff',
    fontSize: 14,
    marginBottom: 8,
  },
  stack: {
    color: '#ffcccc',
    fontSize: 11,
    fontFamily: 'monospace',
  },
});
