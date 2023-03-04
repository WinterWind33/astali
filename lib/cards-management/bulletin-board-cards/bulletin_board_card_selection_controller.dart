// Copyright (c) 2023 Andrea Ballestrazzi

import 'bulletin_board_card_id.dart';

typedef BulletinBoardCardSelectionSet = Set<BulletinBoardCardID>;

class BulletinBoardCardSelectionLock {
  const BulletinBoardCardSelectionLock(final bool bLocked)
      : _bIsSelectionLocked = bLocked;

  bool isSelectionLocked() {
    return _bIsSelectionLocked;
  }

  static void sink(BulletinBoardCardSelectionLock lock) {
    lock = const BulletinBoardCardSelectionLock(false);
  }

  final bool _bIsSelectionLocked;
}

abstract class BulletinBoardCardSafeSelectionController {
  BulletinBoardCardSelectionSet getSelectedCardsIDs();

  void safeSetCardSelectionState(
      final BulletinBoardCardID cardID, final bool bSelected);

  void safeSetCardSelectionStateAndLock(
      final BulletinBoardCardID cardID, final bool bSelected);

  void safeSetCardSelectionStateOrSinkLock(
      final BulletinBoardCardID cardID, final bool bSelected);
}

class BulletinBoardCardSelectionUtils {
  static bool isCardSelected(final BulletinBoardCardID cardID,
      BulletinBoardCardSafeSelectionController selectionController) {
    return selectionController.getSelectedCardsIDs().contains(cardID);
  }

  static void safeSinkLockAndPreserveState(final BulletinBoardCardID cardID,
      BulletinBoardCardSafeSelectionController selectionController) {
    selectionController.safeSetCardSelectionStateOrSinkLock(cardID, true);
  }
}

class BulletinBoardCardSafeSelectionControllerImpl
    implements BulletinBoardCardSafeSelectionController {
  final Map<BulletinBoardCardID, BulletinBoardCardSelectionLock> _selectionMap =
      {};

  @override
  BulletinBoardCardSelectionSet getSelectedCardsIDs() {
    return _selectionMap.keys.toSet();
  }

  @override
  void safeSetCardSelectionState(BulletinBoardCardID cardID, bool bSelected) {
    _changeStateIfPossible(cardID, bSelected, false);
  }

  @override
  void safeSetCardSelectionStateAndLock(
      BulletinBoardCardID cardID, bool bSelected) {
    _changeStateIfPossible(cardID, bSelected, true);
  }

  @override
  void safeSetCardSelectionStateOrSinkLock(
      BulletinBoardCardID cardID, bool bSelected) {
    if (_canChangeState(cardID, bSelected, false)) {
      _changeState(cardID, bSelected, false);
    } else {
      _sinkLockIfSelected(cardID);
    }
  }

  void _changeStateIfPossible(
      BulletinBoardCardID cardID, bool bSelected, final bool lockState) {
    if (_canChangeState(cardID, bSelected, lockState)) {
      _changeState(cardID, bSelected, lockState);
    }
  }

  void _changeState(
      BulletinBoardCardID cardID, bool bSelected, final bool lockState) {
    if (!bSelected) {
      _selectionMap.remove(cardID);
    } else {
      _selectionMap[cardID] = BulletinBoardCardSelectionLock(lockState);
    }
  }

  void _sinkLockIfSelected(BulletinBoardCardID cardID) {
    if (_selectionMap.containsKey(cardID)) {
      _selectionMap[cardID] = const BulletinBoardCardSelectionLock(false);
    }
  }

  bool _canChangeState(
      BulletinBoardCardID cardID, bool bSelected, bool bShouldLock) {
    // We need to check if the cardID is already selected,
    // and if we can set its new state. If the selection is locked we cannot
    // set the new state.
    final bool bIsAlreadySelected = _selectionMap.containsKey(cardID);
    final bool bIsStateLocked =
        bIsAlreadySelected && _selectionMap[cardID]!.isSelectionLocked();

    // We can change state only if there isn't a lock to protect it.
    final bool bNewSelectedState =
        bIsAlreadySelected ^ bSelected && !bIsStateLocked;
    // We can lock only the selected state.
    final bool bNewLockState = !bIsStateLocked && bSelected && bShouldLock;

    // To check if the state is new, we need to perform an XOR operation.
    // If the two states are equal, we don't have to update the state but if
    // the new state is selected == true but it isn't locked
    final bool bCanChangeState = bNewSelectedState || bNewLockState;
    return bCanChangeState;
  }
}
