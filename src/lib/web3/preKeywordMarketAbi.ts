/**
 * Minimal ABI for PREKeywordMarketV1 (Base mainnet), derived from the
 * canonical artifact at PREcommunity/precommunity.org:
 * packages/shared/abi/PREKeywordMarketV1.json.
 *
 * Only the functions/views this app calls are included — signatures match
 * the artifact EXACTLY:
 *
 *   stake(bytes32 keywordId, uint256 amountPre, uint256 bidUsd)
 *   requestUnstake(bytes32 keywordId)
 *   unstake(bytes32 keywordId)
 *   topStakeOf(bytes32 keywordId) -> (address staker, uint256 amount, uint256 bidUsd, uint256 positionVersion, uint256 requiredCoveragePre)
 *   minimumStake() -> uint256
 *   PRE() -> address            (the ERC20 that must be approved before staking)
 *   paused() -> bool
 */
export const preKeywordMarketAbi = [
  {
    type: 'function',
    name: 'stake',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'keywordId', type: 'bytes32', internalType: 'bytes32' },
      { name: 'amountPre', type: 'uint256', internalType: 'uint256' },
      { name: 'bidUsd', type: 'uint256', internalType: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'requestUnstake',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'keywordId', type: 'bytes32', internalType: 'bytes32' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'unstake',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'keywordId', type: 'bytes32', internalType: 'bytes32' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'topStakeOf',
    stateMutability: 'view',
    inputs: [{ name: 'keywordId', type: 'bytes32', internalType: 'bytes32' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        internalType: 'struct PREKeywordMarketV1.StakingDetails',
        components: [
          { name: 'staker', type: 'address', internalType: 'address' },
          { name: 'amount', type: 'uint256', internalType: 'uint256' },
          { name: 'bidUsd', type: 'uint256', internalType: 'uint256' },
          { name: 'positionVersion', type: 'uint256', internalType: 'uint256' },
          { name: 'requiredCoveragePre', type: 'uint256', internalType: 'uint256' },
        ],
      },
    ],
  },
  {
    type: 'function',
    name: 'minimumStake',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
  },
  {
    type: 'function',
    name: 'PRE',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address', internalType: 'contract IERC20' }],
  },
  {
    type: 'function',
    name: 'paused',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'bool', internalType: 'bool' }],
  },
] as const;
