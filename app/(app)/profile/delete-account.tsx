import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { extractErrorMessage, meApi } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';

/**
 * Self-service account erasure (GDPR Art. 17).
 *
 * Calls POST /me/erase with the account password. The server verifies it via
 * bcrypt.compare and returns 400 on mismatch (NOT 401, so the response
 * interceptor does not trigger a refresh/logout cycle), 409 'LAST_ADMIN…'
 * when the requester is the only administrator. On success the account is
 * gone, so we sign out immediately.
 */
export default function DeleteAccountScreen() {
  const { t } = useTranslation();
  const { signOut } = useAuth();

  const [password, setPassword] = useState('');
  const [serverError, setServerError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => meApi.eraseAccount(password),
    onSuccess: async () => {
      await signOut();
    },
    onError: (err: unknown) => {
      const msg = extractErrorMessage(err);
      setServerError(
        msg.includes('LAST_ADMIN') ? t('deleteAccount.lastAdmin') : msg,
      );
    },
  });

  const canSubmit = password.length > 0 && !mutation.isPending;

  const handleSubmit = () => {
    if (!canSubmit) return;
    Alert.alert(
      t('deleteAccount.confirmTitle'),
      t('deleteAccount.confirmBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('deleteAccount.confirmButton'),
          style: 'destructive',
          onPress: () => {
            setServerError(null);
            mutation.mutate();
          },
        },
      ],
    );
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1 }}
    >
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.warnBox}>
          <Ionicons name="warning" size={18} color="#991b1b" />
          <Text style={styles.warnText}>{t('deleteAccount.warning')}</Text>
        </View>

        <Text style={styles.intro}>{t('deleteAccount.intro')}</Text>

        {serverError && (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle" size={16} color="#991b1b" />
            <Text style={styles.errorBoxText}>{serverError}</Text>
          </View>
        )}

        <Text style={styles.fieldLabel}>
          {t('deleteAccount.passwordLabel')}
        </Text>
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={(s) => {
            setPassword(s);
            if (serverError) setServerError(null);
          }}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="password"
          placeholder="••••••••"
          placeholderTextColor="#94a3b8"
        />

        <Pressable
          onPress={handleSubmit}
          disabled={!canSubmit}
          style={({ pressed }) => [
            styles.submitButton,
            !canSubmit && { opacity: 0.5 },
            pressed && canSubmit && { opacity: 0.85 },
          ]}
        >
          {mutation.isPending ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <>
              <Ionicons name="trash" size={18} color="#fff" />
              <Text style={styles.submitButtonText}>
                {t('deleteAccount.submit')}
              </Text>
            </>
          )}
        </Pressable>

        <Text style={styles.note}>{t('deleteAccount.note')}</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f1f5f9' },
  warnBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fef2f2',
    borderColor: '#fecaca',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  warnText: { flex: 1, color: '#991b1b', fontSize: 13, fontWeight: '600' },
  intro: { fontSize: 14, color: '#475569', marginBottom: 16, lineHeight: 20 },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fef2f2',
    borderColor: '#fecaca',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  errorBoxText: { flex: 1, color: '#991b1b', fontSize: 13 },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
    marginTop: 8,
  },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: '#0f172a',
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#dc2626',
    marginTop: 24,
    paddingVertical: 12,
    borderRadius: 10,
  },
  submitButtonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  note: {
    fontSize: 12,
    color: '#94a3b8',
    textAlign: 'center',
    marginTop: 16,
    lineHeight: 18,
  },
});
