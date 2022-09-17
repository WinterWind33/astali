// Copyright (C) 2022 Andrea Ballestrazzi

import 'package:flutter/material.dart';

/// Represents the callbacks that are triggered when an item in the menu
/// settings is tapped.
abstract class SettingsItemsEventHandler {
  /// Called when the 'About' item is clicked.
  void onAboutClicked(BuildContext buildContext);
}
