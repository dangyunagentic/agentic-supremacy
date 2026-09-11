'use client';

import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { format } from 'date-fns';
import {
  ArrowRightLeft,
  ChevronDown,
  ExternalLink,
  Layers,
  Send,
  Sparkles,
  Wallet as WalletIcon,
  Search,
  Check,
  CheckCircle2,
  XCircle,
  Clock,
  RefreshCw,
  Split,
  Equal,
  GitMerge,
} from 'lucide-react';
import { api } from '@/lib/api';
import type { ChainView, Paginated, TransferJobView, WalletView } from '@mintbot/shared';
import { isAddress } from '@mintbot/shared';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { TableSkeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { TxLink } from '@/components/address-display';
import { cn } from '@/lib/utils';

export default function TransfersPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'fund' | 'sweep' | 'disperse' | 'consolidate'>('fund');

  // ── Fund Wallets Form State ──
  const [fundChainKey, setFundChainKey] = useState('base');
  const [fromWalletId, setFromWalletId] = useState<string>('');
  const [selectedDestWalletIds, setSelectedDestWalletIds] = useState<string[]>([]);
  const [customDestAddresses, setCustomDestAddresses] = useState<string>('');
  const [destInputMode, setDestInputMode] = useState<'dropdown' | 'custom' | 'both'>('dropdown');
  const [destSearch, setDestSearch] = useState('');
  const [isDestMenuOpen, setIsDestMenuOpen] = useState(false);

  // Distribution state: 'split_total' (bagi rata) or 'fixed_per_wallet'
  const [distributeMode, setDistributeMode] = useState<'split_total' | 'fixed_per_wallet'>('fixed_per_wallet');
  const [fundAmountInput, setFundAmountInput] = useState<string>('0.01');

  // ── Sweep NFTs Form State ──
  const [sweep, setSweep] = useState({
    chainKey: 'base',
    recipientAddress: '',
    tokenContract: '',
    fromBlock: '',
    sourceWalletIds: [] as string[],
  });
  const [sweepSearch, setSweepSearch] = useState('');
  const [isSweepMenuOpen, setIsSweepMenuOpen] = useState(false);

  // ── Queries ──
  const chains = useQuery({
    queryKey: ['chains'],
    queryFn: () => api.get<ChainView[]>('/chains'),
  });

  const wallets = useQuery({
    queryKey: ['wallets'],
    queryFn: () => api.get<WalletView[]>('/wallets'),
  });

  const transfers = useQuery({
    queryKey: ['transfers'],
    queryFn: () => api.get<Paginated<TransferJobView>>('/transfers?page=1&limit=50'),
    refetchInterval: 5_000,
  });

  // Auto-select first wallet as default fromWallet
  useEffect(() => {
    if (!fromWalletId && wallets.data && wallets.data.length > 0) {
      setFromWalletId(wallets.data[0].id);
    }
  }, [wallets.data, fromWalletId]);

  // Live balance of fromWallet on fundChainKey
  const sourceBalance = useQuery({
    queryKey: ['wallet-balance', fromWalletId, fundChainKey],
    queryFn: () =>
      fromWalletId
        ? api.get<{ address: string; chainKey: string; balance: string; balanceWei: string }>(
            `/wallets/${fromWalletId}/balance?chain=${fundChainKey}`,
          )
        : null,
    enabled: Boolean(fromWalletId && fundChainKey),
    refetchInterval: 10_000,
  });

  // Auto-fetch NFT info for sweep tab
  const nftInfo = useQuery({
    queryKey: ['nft-info', sweep.chainKey, sweep.tokenContract],
    queryFn: () =>
      sweep.tokenContract.trim().length > 3
        ? api.get<{
            name: string | null;
            symbol: string | null;
            imageUrl: string | null;
            contractAddress?: string;
            chainKey?: string;
            source?: string;
          }>(`/transfers/nft-info?chainKey=${sweep.chainKey}&address=${encodeURIComponent(sweep.tokenContract.trim())}`)
        : null,
    enabled: sweep.tokenContract.trim().length > 3,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (nftInfo.data?.chainKey && nftInfo.data.chainKey !== sweep.chainKey) {
      setSweep((prev) => ({ ...prev, chainKey: nftInfo.data!.chainKey! }));
    }
  }, [nftInfo.data, sweep.chainKey]);

  // ── Parse & Combine Destination Addresses ──
  const parsedCustomAddresses = useMemo(() => {
    if (!customDestAddresses.trim()) return [];
    return customDestAddresses
      .split(/[\n,; ]+/)
      .map((a) => a.trim().toLowerCase())
      .filter((a) => isAddress(a));
  }, [customDestAddresses]);

  const allDestinationsCount = useMemo(() => {
    const fromWalletAddress = wallets.data?.find((w) => w.id === fromWalletId)?.address?.toLowerCase();
    
    const internalSelectedAddrs = (wallets.data ?? [])
      .filter((w) => selectedDestWalletIds.includes(w.id))
      .map((w) => w.address.toLowerCase());

    const combined = new Set([
      ...(destInputMode === 'custom' ? [] : internalSelectedAddrs),
      ...(destInputMode === 'dropdown' ? [] : parsedCustomAddresses),
    ]);

    if (fromWalletAddress) {
      combined.delete(fromWalletAddress);
    }
    return combined.size;
  }, [wallets.data, fromWalletId, selectedDestWalletIds, parsedCustomAddresses, destInputMode]);

  // ── Calculate Amount per Wallet vs Total ──
  const { amountPerWalletEth, totalAmountEth } = useMemo(() => {
    const rawNum = parseFloat(fundAmountInput) || 0;
    if (rawNum <= 0 || allDestinationsCount === 0) {
      return { amountPerWalletEth: '0', totalAmountEth: '0' };
    }

    if (distributeMode === 'split_total') {
      // Input is Total ETH -> Divide equally by destination count
      const perWallet = rawNum / allDestinationsCount;
      return {
        amountPerWalletEth: perWallet.toFixed(6),
        totalAmountEth: rawNum.toFixed(6),
      };
    } else {
      // Input is Fixed Amount per wallet -> Multiply by destination count
      const total = rawNum * allDestinationsCount;
      return {
        amountPerWalletEth: rawNum.toFixed(6),
        totalAmountEth: total.toFixed(6),
      };
    }
  }, [fundAmountInput, allDestinationsCount, distributeMode]);

  // ── Handle MAX Button ──
  const handleMaxBalance = () => {
    const balNum = parseFloat(sourceBalance.data?.balance ?? '0');
    if (balNum <= 0) {
      toast.error('Source wallet has 0 balance on this chain');
      return;
    }

    // Reserve gas buffer (0.0005 for L2, 0.002 for L1)
    const isL1 = fundChainKey === 'ethereum' || fundChainKey === 'mainnet';
    const gasReserve = isL1 ? 0.002 : 0.0005;
    const maxSendable = Math.max(0, balNum - gasReserve);

    if (maxSendable <= 0) {
      toast.error('Balance is too low to cover gas reserve');
      return;
    }

    if (distributeMode === 'split_total') {
      setFundAmountInput(maxSendable.toFixed(5));
    } else {
      if (allDestinationsCount > 0) {
        setFundAmountInput((maxSendable / allDestinationsCount).toFixed(6));
      } else {
        setFundAmountInput(maxSendable.toFixed(5));
      }
    }
    toast.success(`Set to MAX sendable balance (~${maxSendable.toFixed(4)} ETH after gas buffer)`);
  };

  // ── Select All / Deselect All for Destination Wallets ──
  const handleSelectAllDest = () => {
    const availableWallets = (wallets.data ?? []).filter((w) => w.id !== fromWalletId);
    if (selectedDestWalletIds.length === availableWallets.length) {
      setSelectedDestWalletIds([]);
    } else {
      setSelectedDestWalletIds(availableWallets.map((w) => w.id));
    }
  };

  // ── Select All / Deselect All for Sweep Wallets ──
  const handleSelectAllSweep = () => {
    const all = wallets.data ?? [];
    if (sweep.sourceWalletIds.length === all.length) {
      setSweep((prev) => ({ ...prev, sourceWalletIds: [] }));
    } else {
      setSweep((prev) => ({ ...prev, sourceWalletIds: all.map((w) => w.id) }));
    }
  };

  // ── Mutations ──
  const createFund = useMutation({
    mutationFn: () => {
      const internalIds = destInputMode === 'custom' ? [] : selectedDestWalletIds;
      const customAddrs = destInputMode === 'dropdown' ? [] : parsedCustomAddresses;
      const combinedTo = [...new Set([...internalIds, ...customAddrs])];

      return api.post('/transfers/fund', {
        chainKey: fundChainKey,
        fromWalletId,
        toWalletIds: combinedTo,
        amountEth: amountPerWalletEth, // backend takes ETH per destination wallet
      });
    },
    onSuccess: () => {
      toast.success('Fund transfer job scheduled');
      void queryClient.invalidateQueries({ queryKey: ['transfers'] });
      void queryClient.invalidateQueries({ queryKey: ['wallet-balance'] });
      setSelectedDestWalletIds([]);
      setCustomDestAddresses('');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const createSweep = useMutation({
    mutationFn: () =>
      api.post('/transfers/transfer-nft', {
        chainKey: sweep.chainKey,
        recipientAddress: sweep.recipientAddress.trim(),
        tokenContract: (nftInfo.data?.contractAddress || sweep.tokenContract).trim(),
        fromWalletIds: sweep.sourceWalletIds,
        fromBlock: sweep.fromBlock ? Number(sweep.fromBlock) : null,
      }),
    onSuccess: () => {
      toast.success('NFT sweep job scheduled');
      void queryClient.invalidateQueries({ queryKey: ['transfers'] });
      setSweep({
        chainKey: 'base',
        recipientAddress: '',
        tokenContract: '',
        fromBlock: '',
        sourceWalletIds: [],
      });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // ── Disperse / Consolidate state ──
  const [disperse, setDisperse] = useState({
    chainKey: 'base',
    fromWalletId: '',
    entriesText: '',
  });
  const [consolidate, setConsolidate] = useState({
    chainKey: 'base',
    mode: 'native' as 'native' | 'erc20',
    toAddress: '',
    tokenContract: '',
    tokenSymbol: '',
    sourceWalletIds: [] as string[],
  });

  const parsedDisperseEntries = useMemo(() => {
    return disperse.entriesText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [address, amount] = line.split(/[,\s]+/);
        return { address: address ?? '', amountEth: amount ?? '' };
      })
      .filter((e) => isAddress(e.address) && parseFloat(e.amountEth) > 0);
  }, [disperse.entriesText]);

  const createDisperse = useMutation({
    mutationFn: () =>
      api.post('/transfers/disperse', {
        chainKey: disperse.chainKey,
        fromWalletId: disperse.fromWalletId,
        entries: parsedDisperseEntries,
      }),
    onSuccess: () => {
      toast.success('Disperse job scheduled');
      void queryClient.invalidateQueries({ queryKey: ['transfers'] });
      setDisperse({ chainKey: 'base', fromWalletId: '', entriesText: '' });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const createConsolidate = useMutation({
    mutationFn: () =>
      api.post('/transfers/consolidate', {
        chainKey: consolidate.chainKey,
        mode: consolidate.mode,
        fromWalletIds: consolidate.sourceWalletIds,
        toAddress: consolidate.toAddress.trim(),
        tokenContract: consolidate.mode === 'erc20' ? consolidate.tokenContract.trim() : undefined,
        tokenSymbol: consolidate.mode === 'erc20' ? consolidate.tokenSymbol.trim() || undefined : undefined,
      }),
    onSuccess: () => {
      toast.success('Consolidate job scheduled');
      void queryClient.invalidateQueries({ queryKey: ['transfers'] });
      setConsolidate({
        chainKey: 'base',
        mode: 'native',
        toAddress: '',
        tokenContract: '',
        tokenSymbol: '',
        sourceWalletIds: [],
      });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const availableDestWallets = (wallets.data ?? []).filter((w) => w.id !== fromWalletId);
  const filteredDestWallets = availableDestWallets.filter(
    (w) =>
      w.address.toLowerCase().includes(destSearch.toLowerCase()) ||
      (w.label && w.label.toLowerCase().includes(destSearch.toLowerCase())),
  );

  const canFund =
    Boolean(fromWalletId) &&
    allDestinationsCount > 0 &&
    parseFloat(amountPerWalletEth) > 0 &&
    !createFund.isPending;

  const canSweep =
    sweep.sourceWalletIds.length > 0 &&
    isAddress(sweep.recipientAddress) &&
    (isAddress(sweep.tokenContract) || Boolean(nftInfo.data?.contractAddress)) &&
    !createSweep.isPending;

  return (
    <>
      <PageHeader
        title="Transfers & Distribution"
        description="Fund multiple wallets with auto-split calculator or sweep NFTs to a single cold wallet"
      />

      <div className="grid gap-6 lg:grid-cols-12">
        {/* Form Card */}
        <Card className="lg:col-span-6 border-border/80 bg-surface shadow-md">
          <CardHeader className="pb-4">
            <div className="flex gap-2 border-b border-border pb-3">
              <Button
                size="sm"
                variant={activeTab === 'fund' ? 'primary' : 'secondary'}
                onClick={() => setActiveTab('fund')}
                className="gap-2 font-medium"
              >
                <Send className="size-3.5" />
                Fund Wallets (ETH / Native)
              </Button>
              <Button
                size="sm"
                variant={activeTab === 'sweep' ? 'primary' : 'secondary'}
                onClick={() => setActiveTab('sweep')}
                className="gap-2 font-medium"
              >
                <ArrowRightLeft className="size-3.5" />
                Sweep NFTs
              </Button>
              <Button
                size="sm"
                variant={activeTab === 'disperse' ? 'primary' : 'secondary'}
                onClick={() => setActiveTab('disperse')}
                className="gap-2 font-medium"
              >
                <Split className="size-3.5" />
                Disperse
              </Button>
              <Button
                size="sm"
                variant={activeTab === 'consolidate' ? 'primary' : 'secondary'}
                onClick={() => setActiveTab('consolidate')}
                className="gap-2 font-medium"
              >
                <GitMerge className="size-3.5" />
                Consolidate
              </Button>
            </div>
          </CardHeader>

          <CardContent className="space-y-4">
            {activeTab === 'fund' ? (
              <>
                {/* Chain & From Wallet Selection */}
                <div className="grid grid-cols-12 gap-3">
                  <div className="col-span-12 sm:col-span-5">
                    <Field label="Chain">
                      <select
                        value={fundChainKey}
                        onChange={(e) => setFundChainKey(e.target.value)}
                        className="input-base w-full"
                      >
                        {(chains.data ?? []).map((c) => (
                          <option key={c.key} value={c.key}>
                            {c.name} ({c.key})
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>

                  <div className="col-span-12 sm:col-span-7">
                    <div className="flex items-center justify-between">
                      <span className="label">From (Main Wallet)</span>
                      <button
                        type="button"
                        onClick={() => void sourceBalance.refetch()}
                        className="flex items-center gap-1 text-[11px] text-accent hover:underline"
                        title="Refresh balance"
                      >
                        <RefreshCw className={cn('size-3', sourceBalance.isFetching && 'animate-spin')} />
                        {sourceBalance.isLoading
                          ? 'Loading...'
                          : `${parseFloat(sourceBalance.data?.balance ?? '0').toFixed(4)} ETH`}
                      </button>
                    </div>
                    <select
                      value={fromWalletId}
                      onChange={(e) => setFromWalletId(e.target.value)}
                      className="input-base w-full mt-1 font-mono text-xs"
                    >
                      {(wallets.data ?? []).map((w, idx) => (
                        <option key={w.id} value={w.id}>
                          {w.label ? `${w.label} - ` : `Wallet #${idx + 1} - `}
                          {w.address.slice(0, 8)}...{w.address.slice(-6)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Amount & MAX Split Calculator */}
                <div className="rounded-[8px] border border-border/80 bg-surface-2/60 p-3.5 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-text-primary">Distribution Amount</span>
                    <div className="flex items-center gap-1 bg-surface rounded-[6px] p-0.5 border border-border">
                      <button
                        type="button"
                        onClick={() => setDistributeMode('fixed_per_wallet')}
                        className={cn(
                          'flex items-center gap-1 px-2 py-0.5 text-[11px] rounded-[4px] font-medium transition-colors',
                          distributeMode === 'fixed_per_wallet'
                            ? 'bg-accent text-accent-fg shadow-xs'
                            : 'text-text-muted hover:text-text-primary',
                        )}
                      >
                        <Equal className="size-3" />
                        Fixed / Wallet
                      </button>
                      <button
                        type="button"
                        onClick={() => setDistributeMode('split_total')}
                        className={cn(
                          'flex items-center gap-1 px-2 py-0.5 text-[11px] rounded-[4px] font-medium transition-colors',
                          distributeMode === 'split_total'
                            ? 'bg-accent text-accent-fg shadow-xs'
                            : 'text-text-muted hover:text-text-primary',
                        )}
                      >
                        <Split className="size-3" />
                        Split Total Evenly
                      </button>
                    </div>
                  </div>

                  <div className="relative flex items-center">
                    <Input
                      type="number"
                      step="0.0001"
                      min="0"
                      value={fundAmountInput}
                      onChange={(e) => setFundAmountInput(e.target.value)}
                      placeholder="0.05"
                      className="mono pr-16 text-sm font-semibold"
                    />
                    <button
                      type="button"
                      onClick={handleMaxBalance}
                      className="absolute right-2 px-2 py-1 rounded bg-accent/15 text-accent text-xs font-bold hover:bg-accent hover:text-accent-fg transition-colors"
                    >
                      MAX
                    </button>
                  </div>

                  {/* Dynamic Calculation Live Box */}
                  <div className="grid grid-cols-3 gap-2 pt-1 border-t border-border/50 text-xs">
                    <div>
                      <span className="text-text-muted text-[10px] block">Per Wallet</span>
                      <span className="font-semibold mono text-text-primary">{amountPerWalletEth} ETH</span>
                    </div>
                    <div>
                      <span className="text-text-muted text-[10px] block">Total Needed</span>
                      <span className="font-semibold mono text-accent">{totalAmountEth} ETH</span>
                    </div>
                    <div>
                      <span className="text-text-muted text-[10px] block">Destinations</span>
                      <span className="font-semibold mono text-text-primary">{allDestinationsCount} wallet(s)</span>
                    </div>
                  </div>
                </div>

                {/* Destinations Mode Selector */}
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="label">Destination Wallets</span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setDestInputMode('dropdown')}
                        className={cn(
                          'text-[11px] px-2 py-0.5 rounded transition-colors',
                          destInputMode === 'dropdown'
                            ? 'bg-surface-2 font-semibold text-text-primary'
                            : 'text-text-muted hover:text-text-primary',
                        )}
                      >
                        Web Wallets ({selectedDestWalletIds.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setDestInputMode('custom')}
                        className={cn(
                          'text-[11px] px-2 py-0.5 rounded transition-colors',
                          destInputMode === 'custom'
                            ? 'bg-surface-2 font-semibold text-text-primary'
                            : 'text-text-muted hover:text-text-primary',
                        )}
                      >
                        Custom 0x Input ({parsedCustomAddresses.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setDestInputMode('both')}
                        className={cn(
                          'text-[11px] px-2 py-0.5 rounded transition-colors',
                          destInputMode === 'both'
                            ? 'bg-surface-2 font-semibold text-text-primary'
                            : 'text-text-muted hover:text-text-primary',
                        )}
                      >
                        Both
                      </button>
                    </div>
                  </div>

                  {/* Mode 1: Dropdown / Multi-select Web Wallets */}
                  {(destInputMode === 'dropdown' || destInputMode === 'both') && (
                    <div className="space-y-2 mb-3">
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => setIsDestMenuOpen((o) => !o)}
                          className="input-base flex items-center justify-between gap-2 text-left w-full text-xs"
                        >
                          <span className="truncate">
                            {selectedDestWalletIds.length === 0
                              ? 'Select destination wallets...'
                              : selectedDestWalletIds.length === availableDestWallets.length
                                ? `All ${availableDestWallets.length} web wallets selected`
                                : `${selectedDestWalletIds.length} web wallet(s) selected`}
                          </span>
                          <ChevronDown className={cn('size-4 shrink-0 transition-transform', isDestMenuOpen && 'rotate-180')} />
                        </button>

                        {isDestMenuOpen && (
                          <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-[8px] border border-border bg-surface shadow-2xl">
                            <div className="flex items-center justify-between border-b border-border px-3 py-2">
                              <div className="flex items-center gap-2 flex-1">
                                <Search className="size-3.5 text-text-muted" />
                                <input
                                  value={destSearch}
                                  onChange={(e) => setDestSearch(e.target.value)}
                                  placeholder="Search address or label..."
                                  className="w-full bg-transparent text-xs outline-none"
                                />
                              </div>
                              <button
                                type="button"
                                onClick={handleSelectAllDest}
                                className="text-[11px] font-semibold text-accent hover:underline ml-2"
                              >
                                {selectedDestWalletIds.length === availableDestWallets.length
                                  ? 'Deselect all'
                                  : 'Select all'}
                              </button>
                            </div>

                            <div className="max-h-56 overflow-y-auto p-1 text-xs">
                              {filteredDestWallets.map((w, idx) => {
                                const isChecked = selectedDestWalletIds.includes(w.id);
                                return (
                                  <label
                                    key={w.id}
                                    className={cn(
                                      'flex items-center gap-2.5 rounded px-2.5 py-1.5 cursor-pointer hover:bg-surface-2 transition-colors',
                                      isChecked && 'bg-accent/10',
                                    )}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={isChecked}
                                      onChange={() =>
                                        setSelectedDestWalletIds((prev) =>
                                          prev.includes(w.id)
                                            ? prev.filter((id) => id !== w.id)
                                            : [...prev, w.id],
                                        )
                                      }
                                      className="rounded border-border"
                                    />
                                    <span className="font-medium text-text-primary">
                                      {w.label || `Wallet #${idx + 1}`}
                                    </span>
                                    <span className="mono text-[11px] text-text-muted ml-auto">
                                      {w.address.slice(0, 6)}...{w.address.slice(-4)}
                                    </span>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Mode 2: Custom / External Address Input Textarea */}
                  {(destInputMode === 'custom' || destInputMode === 'both') && (
                    <div>
                      <Field
                        label="External Wallet Addresses (0x...)"
                        hint="Paste addresses (1 per line or comma-separated). No need to import to web."
                      >
                        <textarea
                          value={customDestAddresses}
                          onChange={(e) => setCustomDestAddresses(e.target.value)}
                          placeholder="0x1234567890abcdef1234567890abcdef12345678&#10;0xabcdef1234567890abcdef1234567890abcdef12"
                          rows={3}
                          className="input-base w-full mono text-xs p-2 leading-relaxed"
                        />
                      </Field>
                      {parsedCustomAddresses.length > 0 && (
                        <p className="text-[11px] text-success font-medium mt-1">
                          ✓ {parsedCustomAddresses.length} valid external destination address(es) detected
                        </p>
                      )}
                    </div>
                  )}
                </div>

                <Button
                  onClick={() => createFund.mutate()}
                  loading={createFund.isPending}
                  disabled={!canFund}
                  className="w-full gap-2 font-semibold"
                  size="md"
                >
                  <Send className="size-4" />
                  Send {amountPerWalletEth} ETH to {allDestinationsCount} wallet(s) (Total ~{totalAmountEth} ETH)
                </Button>
              </>
            ) : activeTab === 'sweep' ? (
              /* ── Sweep NFTs Tab ── */
              <>
                <div className="grid grid-cols-12 gap-3">
                  <div className="col-span-12 sm:col-span-4">
                    <Field label="Chain">
                      <select
                        value={sweep.chainKey}
                        onChange={(e) => setSweep((s) => ({ ...s, chainKey: e.target.value }))}
                        className="input-base w-full"
                      >
                        {(chains.data ?? []).map((c) => (
                          <option key={c.key} value={c.key}>
                            {c.name} ({c.key})
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>

                  <div className="col-span-12 sm:col-span-8">
                    <Field label="Cold / Recipient Address" hint="Destination wallet that receives all NFTs">
                      <Input
                        value={sweep.recipientAddress}
                        onChange={(e) => setSweep((s) => ({ ...s, recipientAddress: e.target.value }))}
                        placeholder="0x..."
                        className="mono text-xs"
                      />
                    </Field>
                  </div>
                </div>

                {/* Token contract with Auto-fetch NFT preview */}
                <div>
                  <Field
                    label="NFT Token Contract / OpenSea Link"
                    hint="ERC-721 contract address (0x...) or OpenSea asset/collection URL"
                  >
                    <div className="relative">
                      <Input
                        value={sweep.tokenContract}
                        onChange={(e) => setSweep((s) => ({ ...s, tokenContract: e.target.value }))}
                        placeholder="0x... or https://opensea.io/assets/base/0x.../1"
                        className="mono text-xs pr-8"
                      />
                      {nftInfo.isFetching && (
                        <div className="absolute right-2.5 top-2.5">
                          <RefreshCw className="size-4 animate-spin text-accent" />
                        </div>
                      )}
                    </div>
                  </Field>

                  {/* NFT Preview Card */}
                  {nftInfo.data && (nftInfo.data.name || nftInfo.data.imageUrl || nftInfo.data.symbol) && (
                    <div className="mt-2.5 flex items-center gap-3 rounded-[8px] border border-accent/30 bg-accent-subtle/50 p-2.5">
                      {nftInfo.data.imageUrl ? (
                        <img
                          src={nftInfo.data.imageUrl}
                          alt={nftInfo.data.name || 'NFT'}
                          className="size-10 rounded-[6px] object-cover border border-border"
                        />
                      ) : (
                        <div className="flex size-10 items-center justify-center rounded-[6px] bg-surface-2 border border-border">
                          <Sparkles className="size-4 text-accent" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-xs text-text-primary truncate">
                            {nftInfo.data.name || 'NFT Collection'}
                          </span>
                          {nftInfo.data.symbol && (
                            <Badge tone="neutral" className="text-[9px] px-1 py-0 uppercase">
                              {nftInfo.data.symbol}
                            </Badge>
                          )}
                        </div>
                        <p className="mono text-[10px] text-text-muted truncate mt-0.5">
                          {nftInfo.data.contractAddress || sweep.tokenContract}
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Source Wallets for Sweep */}
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="label">Source Wallets to Sweep</span>
                    <button
                      type="button"
                      onClick={handleSelectAllSweep}
                      className="text-[11px] font-semibold text-accent hover:underline"
                    >
                      {sweep.sourceWalletIds.length === (wallets.data?.length ?? 0)
                        ? 'Deselect all'
                        : 'Select all'}
                    </button>
                  </div>
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setIsSweepMenuOpen((o) => !o)}
                      className="input-base flex items-center justify-between gap-2 text-left w-full text-xs"
                    >
                      <span className="truncate">
                        {sweep.sourceWalletIds.length === 0
                          ? 'Select source wallets...'
                          : `${sweep.sourceWalletIds.length} source wallet(s) selected`}
                      </span>
                      <ChevronDown className={cn('size-4 shrink-0 transition-transform', isSweepMenuOpen && 'rotate-180')} />
                    </button>

                    {isSweepMenuOpen && (
                      <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-[8px] border border-border bg-surface shadow-2xl">
                        <div className="max-h-56 overflow-y-auto p-1 text-xs">
                          {(wallets.data ?? []).map((w, idx) => {
                            const isChecked = sweep.sourceWalletIds.includes(w.id);
                            return (
                              <label
                                key={w.id}
                                className={cn(
                                  'flex items-center gap-2.5 rounded px-2.5 py-1.5 cursor-pointer hover:bg-surface-2 transition-colors',
                                  isChecked && 'bg-accent/10',
                                )}
                              >
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() =>
                                    setSweep((s) => ({
                                      ...s,
                                      sourceWalletIds: isChecked
                                        ? s.sourceWalletIds.filter((id) => id !== w.id)
                                        : [...s.sourceWalletIds, w.id],
                                    }))
                                  }
                                  className="rounded border-border"
                                />
                                <span className="font-medium text-text-primary">
                                  {w.label || `Wallet #${idx + 1}`}
                                </span>
                                <span className="mono text-[11px] text-text-muted ml-auto">
                                  {w.address.slice(0, 6)}...{w.address.slice(-4)}
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <Button
                  onClick={() => createSweep.mutate()}
                  loading={createSweep.isPending}
                  disabled={!canSweep}
                  className="w-full gap-2 font-semibold"
                  size="md"
                >
                  <ArrowRightLeft className="size-4" />
                  Sweep all NFTs from {sweep.sourceWalletIds.length} wallet(s)
                </Button>
              </>
            ) : activeTab === 'disperse' ? (
              /* ── Disperse Tab ── */
              <>
                <div className="grid grid-cols-12 gap-3">
                  <div className="col-span-12 sm:col-span-4">
                    <Field label="Chain">
                      <select
                        value={disperse.chainKey}
                        onChange={(e) => setDisperse((d) => ({ ...d, chainKey: e.target.value }))}
                        className="input-base w-full"
                      >
                        {(chains.data ?? []).map((c) => (
                          <option key={c.key} value={c.key}>
                            {c.name} ({c.key})
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <div className="col-span-12 sm:col-span-8">
                    <Field label="From wallet">
                      <select
                        value={disperse.fromWalletId}
                        onChange={(e) => setDisperse((d) => ({ ...d, fromWalletId: e.target.value }))}
                        className="input-base w-full font-mono text-xs"
                      >
                        <option value="">Select source wallet...</option>
                        {(wallets.data ?? []).map((w, idx) => (
                          <option key={w.id} value={w.id}>
                            {w.label ? `${w.label} - ` : `Wallet #${idx + 1} - `}
                            {w.address.slice(0, 8)}...{w.address.slice(-6)}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                </div>

                <Field
                  label="Entries (address + amount)"
                  hint="One per line: 0xADDRESS 0.05 — variable amounts per destination"
                >
                  <textarea
                    value={disperse.entriesText}
                    onChange={(e) => setDisperse((d) => ({ ...d, entriesText: e.target.value }))}
                    placeholder={'0x1111111111111111111111111111111111111111 0.01\n0x2222222222222222222222222222222222222222 0.05'}
                    rows={5}
                    className="input-base w-full mono text-xs p-2 leading-relaxed"
                  />
                </Field>
                {parsedDisperseEntries.length > 0 && (
                  <p className="text-[11px] text-success font-medium">
                    ✓ {parsedDisperseEntries.length} valid entr(y/ies) detected
                  </p>
                )}

                <Button
                  onClick={() => createDisperse.mutate()}
                  loading={createDisperse.isPending}
                  disabled={!disperse.fromWalletId || parsedDisperseEntries.length === 0}
                  className="w-full gap-2 font-semibold"
                  size="md"
                >
                  <Split className="size-4" />
                  Disperse to {parsedDisperseEntries.length} address(es)
                </Button>
              </>
            ) : (
              /* ── Consolidate Tab ── */
              <>
                <div className="grid grid-cols-12 gap-3">
                  <div className="col-span-12 sm:col-span-4">
                    <Field label="Chain">
                      <select
                        value={consolidate.chainKey}
                        onChange={(e) => setConsolidate((c) => ({ ...c, chainKey: e.target.value }))}
                        className="input-base w-full"
                      >
                        {(chains.data ?? []).map((c) => (
                          <option key={c.key} value={c.key}>
                            {c.name} ({c.key})
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <div className="col-span-12 sm:col-span-4">
                    <Field label="Mode">
                      <select
                        value={consolidate.mode}
                        onChange={(e) => setConsolidate((c) => ({ ...c, mode: e.target.value as 'native' | 'erc20' }))}
                        className="input-base w-full"
                      >
                        <option value="native">Native (ETH)</option>
                        <option value="erc20">ERC-20 token</option>
                      </select>
                    </Field>
                  </div>
                  <div className="col-span-12 sm:col-span-4">
                    <Field label="Destination address">
                      <Input
                        value={consolidate.toAddress}
                        onChange={(e) => setConsolidate((c) => ({ ...c, toAddress: e.target.value }))}
                        placeholder="0x..."
                        className="mono text-xs"
                      />
                    </Field>
                  </div>
                </div>

                {consolidate.mode === 'erc20' && (
                  <div className="grid grid-cols-12 gap-3">
                    <div className="col-span-12 sm:col-span-7">
                      <Field label="Token contract">
                        <Input
                          value={consolidate.tokenContract}
                          onChange={(e) => setConsolidate((c) => ({ ...c, tokenContract: e.target.value }))}
                          placeholder="0x..."
                          className="mono text-xs"
                        />
                      </Field>
                    </div>
                    <div className="col-span-12 sm:col-span-5">
                      <Field label="Token symbol (optional)">
                        <Input
                          value={consolidate.tokenSymbol}
                          onChange={(e) => setConsolidate((c) => ({ ...c, tokenSymbol: e.target.value }))}
                          placeholder="USDC"
                          className="text-xs"
                        />
                      </Field>
                    </div>
                  </div>
                )}

                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="label">Source wallets to drain</span>
                    <button
                      type="button"
                      onClick={() => {
                        const all = wallets.data ?? [];
                        setConsolidate((c) => ({
                          ...c,
                          sourceWalletIds: c.sourceWalletIds.length === all.length ? [] : all.map((w) => w.id),
                        }));
                      }}
                      className="text-[11px] font-semibold text-accent hover:underline"
                    >
                      {consolidate.sourceWalletIds.length === (wallets.data?.length ?? 0)
                        ? 'Deselect all'
                        : 'Select all'}
                    </button>
                  </div>
                  <div className="max-h-48 overflow-y-auto rounded-[8px] border border-border p-1 text-xs">
                    {(wallets.data ?? []).map((w, idx) => {
                      const isChecked = consolidate.sourceWalletIds.includes(w.id);
                      return (
                        <label
                          key={w.id}
                          className={cn(
                            'flex items-center gap-2.5 rounded px-2.5 py-1.5 cursor-pointer hover:bg-surface-2 transition-colors',
                            isChecked && 'bg-accent/10',
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() =>
                              setConsolidate((c) => ({
                                ...c,
                                sourceWalletIds: isChecked
                                  ? c.sourceWalletIds.filter((id) => id !== w.id)
                                  : [...c.sourceWalletIds, w.id],
                              }))
                            }
                            className="rounded border-border"
                          />
                          <span className="font-medium text-text-primary">{w.label || `Wallet #${idx + 1}`}</span>
                          <span className="mono text-[11px] text-text-muted ml-auto">
                            {w.address.slice(0, 6)}...{w.address.slice(-4)}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <Button
                  onClick={() => createConsolidate.mutate()}
                  loading={createConsolidate.isPending}
                  disabled={
                    consolidate.sourceWalletIds.length === 0 ||
                    !isAddress(consolidate.toAddress) ||
                    (consolidate.mode === 'erc20' && !isAddress(consolidate.tokenContract))
                  }
                  className="w-full gap-2 font-semibold"
                  size="md"
                >
                  <GitMerge className="size-4" />
                  Consolidate {consolidate.sourceWalletIds.length} wallet(s)
                </Button>
              </>
            )}
          </CardContent>
        </Card>

        {/* Transfers History Card */}
        <Card className="lg:col-span-6 border-border/80 bg-surface shadow-md">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Transfer History</CardTitle>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void queryClient.invalidateQueries({ queryKey: ['transfers'] })}
              >
                <RefreshCw className="size-3.5" />
                Refresh
              </Button>
            </div>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            {transfers.isLoading ? (
              <TableSkeleton rows={4} />
            ) : (transfers.data?.data ?? []).length === 0 ? (
              <p className="p-6 text-center text-sm text-text-secondary">No transfer jobs executed yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <THead>
                    <TR>
                      <TH>Type</TH>
                      <TH>Chain</TH>
                      <TH>Details</TH>
                      <TH>Status</TH>
                      <TH className="text-right">Time</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {(transfers.data?.data ?? []).map((job) => (
                      <TR key={job.id}>
                        <TD>
                          <Badge tone={job.kind === 'fund' ? 'accent' : 'warning'} className="uppercase text-[10px]">
                            {job.kind}
                          </Badge>
                        </TD>
                        <TD className="text-xs uppercase font-mono">{job.chainKey}</TD>
                        <TD className="text-xs">
                          {job.kind === 'fund' ? (
                            <span>
                              {job.amountEth} ETH → {job.targetCount} wallet(s)
                            </span>
                          ) : (
                            <span>
                              {job.targetCount} wallets → {job.recipientAddress?.slice(0, 6)}...
                            </span>
                          )}
                          {job.error && (
                            <span className="block text-[10px] text-danger truncate max-w-[200px]" title={job.error}>
                              {job.error}
                            </span>
                          )}
                        </TD>
                        <TD>
                          <Badge
                            tone={
                              job.status === 'completed'
                                ? 'success'
                                : job.status === 'failed'
                                  ? 'danger'
                                  : 'accent'
                            }
                            className="text-[10px] uppercase font-mono"
                          >
                            {job.status}
                          </Badge>
                        </TD>
                        <TD className="text-right text-[11px] text-text-muted mono">
                          {format(new Date(job.createdAt), 'HH:mm:ss')}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
