// Copyright (C) 2022 Andrea Ballestrazzi

import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/material.dart';

// Mockito
import 'package:mockito/annotations.dart';

// Production classes
import 'package:astali/default_settings_menu_spawner.dart';
import 'package:astali/main.dart';

@GenerateMocks([DefaultSettingsMenuEventHandler])
void main() {
  testWidgets("The default settings menu should have an 'About' section",
      (tester) async {
    await tester.pumpWidget(const AstaliApp());

    // Now we need to generate the settings menu. Here we tap the settings button.
    await tester.tap(find.byIcon(Icons.settings));
    await tester.pump();

    final aboutItemFinder = find.text("About");

    // We should have only one widget with the title "About".
    expect(aboutItemFinder, findsOneWidget);
  });
}
